import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertMatchesSchema } from './contract-conformance';
import { ADMIN_URL, apiFor, idem, startHarness, withClient, type Harness } from './harness';

/**
 * Execution Log와 전자상황판 E2E (CC-290, UNE-JNL-001~004).
 *
 * 증명해야 하는 것.
 *   (1) 대시보드가 **이벤트에서** 계산된다 — 임무 행을 손으로 바꿔도 판이
 *       흔들리지 않는다.
 *   (2) `at`이 **그 시점의 판**을 낸다.
 *   (3) 정정은 원본을 고치지 않고 새 이벤트를 더한다.
 *   (4) 정정의 정정을 막고, 시스템 관측 이벤트를 정정하지 못한다.
 *   (5) 상태 변경이 사실원장을 건너뛰지 않는다(릴레이의 `TASK_SENT`).
 *   (6) 타임라인이 원본을 감추지 않는다.
 *   (7) 테넌트 경계.
 */

interface Ready {
  situationId: string;
  runId: string;
  taskIds: string[];
}

describe.skipIf(!ADMIN_URL)('Execution Log·전자상황판 (CC-290)', () => {
  let h: Harness;
  let api: ReturnType<typeof apiFor>;
  let adminToken: string;
  let fieldToken: string;
  let otherToken: string;

  const errorCode = async (res: Response): Promise<string> => {
    const parsed = (await res.json()) as { error?: { code?: string } };
    return parsed.error?.code ?? 'NO_CODE';
  };

  /** 실행 하나 + 임무 둘. 담당자는 fieldA. */
  const seedRun = async (code: string, steps = 2): Promise<Ready> =>
    withClient(h.dbUrl, async (c) => {
      const situationId = (
        await c.query(
          `INSERT INTO situation (tenant_id, mode, title, hazard_type, status, created_by)
           VALUES ($1,'LIVE',$2,'FLOOD','RUNNING',$3) RETURNING situation_id`,
          [h.fixtures.tenantA, `상황 ${code}`, h.fixtures.adminA],
        )
      ).rows[0].situation_id as string;
      const snapshotId = (
        await c.query(
          `INSERT INTO situation_snapshot
             (situation_id, version_no, facts_json, content_hash, effective_at, confirmed_by)
           VALUES ($1,1,'[{"factType":"DAMAGE","value":"침수"}]'::jsonb,$2,now(),$3)
           RETURNING snapshot_id`,
          [situationId, 'e'.repeat(64), h.fixtures.adminA],
        )
      ).rows[0].snapshot_id as string;
      const sopId = (
        await c.query(
          `INSERT INTO sop (tenant_id, situation_id, title, hazard_type, status, created_by)
           VALUES ($1,$2,$3,'FLOOD','APPROVED',$4) RETURNING sop_id`,
          [h.fixtures.tenantA, situationId, `SOP ${code}`, h.fixtures.adminA],
        )
      ).rows[0].sop_id as string;
      const versionId = (
        await c.query(
          `INSERT INTO sop_version (sop_id, version_no, status, graph_hash, schema_version, created_by)
           VALUES ($1,1,'DRAFT',$2,'sop-editor-1',$3) RETURNING sop_version_id`,
          [sopId, 'f'.repeat(64), h.fixtures.adminA],
        )
      ).rows[0].sop_version_id as string;

      const nodeIds: string[] = [];
      for (let i = 0; i < steps; i += 1) {
        nodeIds.push(
          (
            await c.query(
              `INSERT INTO sop_node (sop_version_id, node_key, node_type, title, config_json, sort_order)
               VALUES ($1,$2,'ACTION',$3,'{}'::jsonb,$4) RETURNING node_id`,
              [versionId, `a${i}`, `임무 ${i}`, i + 1],
            )
          ).rows[0].node_id as string,
        );
      }
      // 노드를 다 넣은 뒤에 잠근다 — 0035가 승인된 버전의 그래프 변경을 막는다.
      await c.query(
        `UPDATE sop_version SET status='LOCKED', approved_by=$2, approved_at=now()
          WHERE sop_version_id=$1`,
        [versionId, h.fixtures.adminA],
      );

      const runId = (
        await c.query(
          `INSERT INTO sop_run
             (sop_version_id, situation_id, snapshot_id, mode, status, started_by, correlation_id)
           VALUES ($1,$2,$3,'LIVE','RUNNING',$4,$5) RETURNING run_id`,
          [versionId, situationId, snapshotId, h.fixtures.adminA, `corr-${code}`],
        )
      ).rows[0].run_id as string;

      const taskIds: string[] = [];
      for (let i = 0; i < steps; i += 1) {
        const taskId = (
          await c.query(
            `INSERT INTO task
               (run_id, node_id, title, status, assignee_user_id, completion_policy_json,
                progress_pct, activated_at, due_at)
             VALUES ($1,$2,$3,'SENT',$4,'{"instructions":["수행"]}'::jsonb,0,now(),$5)
             RETURNING task_id`,
            [
              runId,
              nodeIds[i],
              `임무 ${i}`,
              h.fixtures.fieldA,
              // 두 번째 임무는 기한이 이미 지났다 — 지연 집계를 본다.
              i === 1 ? new Date(Date.now() - 3_600_000) : null,
            ],
          )
        ).rows[0].task_id as string;
        // 실행이 만든 것처럼 생성 이벤트를 남긴다(운영에서는 UNE-SOP-011이 한다).
        await c.query(
          `INSERT INTO execution_event
             (tenant_id, situation_id, aggregate_type, aggregate_id, event_type,
              actor_id, payload_json, correlation_id, event_hash)
           VALUES ($1,$2,'TASK',$3,'TASK_CREATED',$4,$5::jsonb,$6,$7)`,
          [
            h.fixtures.tenantA,
            situationId,
            taskId,
            h.fixtures.adminA,
            JSON.stringify({ status: 'SENT', runId, nodeKey: `a${i}` }),
            `corr-${code}`,
            `${'1'.repeat(63)}${i}`,
          ],
        );
        taskIds.push(taskId);
      }
      return { situationId, runId, taskIds };
    });

  const dashboard = async (
    situationId: string,
    query = '',
    token = adminToken,
  ): Promise<Response> =>
    api.call('GET', `/api/v1/situations/${situationId}/dashboard${query}`, token);

  const post = async (
    taskId: string,
    action: string,
    body: Record<string, unknown>,
    token: string,
  ): Promise<Response> =>
    api.call('POST', `/api/v1/tasks/${taskId}/${action}`, token, {
      body,
      idempotencyKey: idem(action),
    });

  const eventsOf = async (situationId: string, query = ''): Promise<Response> =>
    api.call('GET', `/api/v1/situations/${situationId}/execution-events${query}`, adminToken);

  beforeAll(async () => {
    h = await startHarness('cc290_e2e');
    api = apiFor(h);
    adminToken = await api.login(h.fixtures.tenantA, 'admin-a');
    fieldToken = await api.login(h.fixtures.tenantA, 'field-a');
    otherToken = await api.login(h.fixtures.tenantB, 'user-b');
  }, 180_000);

  afterAll(async () => {
    await h?.close();
  });

  it('대시보드가 이벤트를 접어 KPI를 만든다', async () => {
    const r = await seedRun('kpi');
    await post(r.taskIds[0], 'acknowledge', {}, fieldToken);
    await post(r.taskIds[0], 'start', {}, fieldToken);

    const res = await dashboard(r.situationId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        kpi: Record<string, number>;
        tasks: Array<{ taskId: string; status: string; overdue: boolean }>;
        provenance: { timeAxis: string; eventCount: number };
      };
    };
    expect(body.data.kpi.total).toBe(2);
    expect(body.data.kpi.inProgress).toBe(1);
    expect(body.data.kpi.awaitingAck).toBe(1);
    // 두 번째 임무는 기한이 지났다.
    expect(body.data.kpi.overdue).toBe(1);
    expect(body.data.provenance.timeAxis).toBe('occurredAt');
    expect(body.data.provenance.eventCount).toBeGreaterThan(0);
  });

  it('실제 응답이 계약을 만족한다', async () => {
    // **이 검증이 없어서 두 번 새어 나갔다.** CC-280은 서버가 내보내는 enum
    // 값이 계약에 없었고, CC-290은 allOf + additionalProperties:false 조합이라
    // 스키마가 어떤 응답으로도 만족될 수 없었다(ADR-24 D4). validate:contracts는
    // example만 보고 계약 게이트는 문자열만 훑는다.
    const r = await seedRun('conformance', 1);
    await post(r.taskIds[0], 'acknowledge', {}, fieldToken);
    await post(r.taskIds[0], 'start', {}, fieldToken);
    await post(r.taskIds[0], 'progress', { progress: 30, note: 'a' }, fieldToken);

    const board = (await (await dashboard(r.situationId)).json()) as { data: unknown };
    assertMatchesSchema('DashboardView', board.data);

    const page = (await (await eventsOf(r.situationId, '?size=100')).json()) as {
      data: { items: Array<{ eventId: string; eventType: string }> };
    };
    assertMatchesSchema('ExecutionEventPage', page.data);

    const progressEvent = page.data.items.find((e) => e.eventType === 'TASK_PROGRESS_REPORTED');
    const detail = (await (
      await api.call('GET', `/api/v1/execution-events/${progressEvent?.eventId}`, adminToken)
    ).json()) as { data: unknown };
    assertMatchesSchema('ExecutionEventDetail', detail.data);

    const correction = (await (
      await api.call(
        'POST',
        `/api/v1/execution-events/${progressEvent?.eventId}/corrections`,
        adminToken,
        { body: { reason: '오타', replacementFields: { note: 'b' } }, idempotencyKey: idem('c') },
      )
    ).json()) as { data: unknown };
    assertMatchesSchema('ExecutionEvent', correction.data);
  });

  it('정정해도 임무 상태가 되돌아가지 않는다', async () => {
    // 정정 이벤트를 새 관측으로 세면 그것이 마지막 이벤트가 되고, 정정한
    // 시각과 원본에서 딸려 온 status가 이겨 **완료된 임무가 진행으로
    // 되돌아간다**(실측으로 그랬다).
    const r = await seedRun('no-regress', 1);
    await post(r.taskIds[0], 'acknowledge', {}, fieldToken);
    await post(r.taskIds[0], 'start', {}, fieldToken);
    await post(r.taskIds[0], 'progress', { progress: 40, note: '절바' }, fieldToken);
    await post(r.taskIds[0], 'complete', { result: '완료' }, fieldToken);
    await post(r.taskIds[0], 'approve-completion', {}, adminToken);

    const before = (await (await dashboard(r.situationId)).json()) as {
      data: { kpi: Record<string, number> };
    };
    expect(before.data.kpi.completed).toBe(1);

    const page = (await (await eventsOf(r.situationId, '?type=TASK_PROGRESS_REPORTED')).json()) as {
      data: { items: Array<{ eventId: string }> };
    };
    await api.call(
      'POST',
      `/api/v1/execution-events/${page.data.items[0].eventId}/corrections`,
      adminToken,
      { body: { reason: '오타', replacementFields: { note: '절반' } }, idempotencyKey: idem('c') },
    );

    const after = (await (await dashboard(r.situationId)).json()) as {
      data: {
        kpi: Record<string, number>;
        tasks: Array<{ status: string }>;
        recentEvents: Array<{
          eventId: string;
          eventType: string;
          payload: Record<string, unknown>;
        }>;
      };
    };
    expect(after.data.kpi.completed).toBe(1);
    expect(after.data.kpi.inProgress).toBe(0);
    expect(after.data.tasks[0].status).toBe('COMPLETED');

    // 그리고 대시보드의 최근 이벤트도 **원본 payload**를 낸다 — 정정본을
    // 원본 id·해시와 함께 내보내면 해시 검증이 깨진다.
    const original = after.data.recentEvents.find((e) => e.eventId === page.data.items[0].eventId);
    expect(original?.payload.note).toBe('절바');
    expect(after.data.recentEvents.some((e) => e.eventType === 'EXECUTION_EVENT_CORRECTED')).toBe(
      true,
    );
  });

  it('재생과 임무 행이 어긋나면 응답이 그것을 말한다', async () => {
    // D1의 전제를 매 조회가 측정한다. 빠진 이벤트는 "그 일이 없었다"로 조용히
    // 읽히므로, 대조하지 않으면 아무도 모른다.
    const r = await seedRun('divergence', 1);
    await post(r.taskIds[0], 'acknowledge', {}, fieldToken);

    const clean = (await (await dashboard(r.situationId)).json()) as {
      data: { provenance: { divergences: unknown[]; tasksWithoutEvents: number } };
    };
    expect(clean.data.provenance.divergences).toEqual([]);
    expect(clean.data.provenance.tasksWithoutEvents).toBe(0);

    // 사실원장을 건너뛴 상태 변경을 흉내 낸다.
    await withClient(h.dbUrl, (c) =>
      c.query(`UPDATE task SET status='IN_PROGRESS' WHERE task_id=$1`, [r.taskIds[0]]),
    );
    const diverged = (await (await dashboard(r.situationId)).json()) as {
      data: { provenance: { divergences: Array<{ replayed: string; stored: string }> } };
    };
    expect(diverged.data.provenance.divergences).toHaveLength(1);
    expect(diverged.data.provenance.divergences[0]).toMatchObject({
      replayed: 'ACKNOWLEDGED',
      stored: 'IN_PROGRESS',
    });
  });

  it('진행률도 이벤트에서 복원되고 상태의 근거를 함께 낸다', async () => {
    const r = await seedRun('progress-replay', 1);
    await post(r.taskIds[0], 'acknowledge', {}, fieldToken);
    await post(r.taskIds[0], 'start', {}, fieldToken);
    await post(r.taskIds[0], 'progress', { progress: 35 }, fieldToken);

    // 임무 행의 진행률을 손으로 바꿔도 판은 이벤트를 따른다.
    await withClient(h.dbUrl, (c) =>
      c.query(`UPDATE task SET progress_pct=99 WHERE task_id=$1`, [r.taskIds[0]]),
    );
    const body = (await (await dashboard(r.situationId)).json()) as {
      data: { tasks: Array<{ progressPct: number | null; statusEventId: string }> };
    };
    expect(body.data.tasks[0].progressPct).toBe(35);
    // KPI에서 사실원장으로 내려가는 길이 열려 있다.
    const detail = await api.call(
      'GET',
      `/api/v1/execution-events/${body.data.tasks[0].statusEventId}`,
      adminToken,
    );
    expect(detail.status).toBe(200);
  });

  it('실행 스코프에서 취소된 임무가 빠지지 않는다', async () => {
    // `payload.runId`에 기대면 그 필드를 빠뜨린 이벤트가 조용히 탈락하고
    // 그 임무가 영원히 직전 상태로 보인다.
    const r = await seedRun('run-scope', 1);
    await withClient(h.dbUrl, (c) =>
      c.query(`UPDATE task SET status='CANCELLED' WHERE task_id=$1`, [r.taskIds[0]]),
    );
    await withClient(h.dbUrl, async (c) => {
      await c.query(
        `INSERT INTO execution_event
           (tenant_id, situation_id, aggregate_type, aggregate_id, event_type,
            actor_id, payload_json, correlation_id, event_hash)
         VALUES ($1,$2,'TASK',$3,'TASK_CANCELLED',$4,$5::jsonb,'corr-scope',$6)`,
        [
          h.fixtures.tenantA,
          r.situationId,
          r.taskIds[0],
          h.fixtures.adminA,
          // **runId가 없는 payload** — 실제 취소 경로가 그랬다.
          JSON.stringify({ status: 'CANCELLED', reason: '종료' }),
          '9'.repeat(64),
        ],
      );
    });

    const scoped = (await (await dashboard(r.situationId, `?runId=${r.runId}`)).json()) as {
      data: { kpi: Record<string, number> };
    };
    expect(scoped.data.kpi.cancelled).toBe(1);
    expect(scoped.data.kpi.awaitingAck).toBe(0);
  });

  it('과대한 정정 본문은 413이다', async () => {
    const r = await seedRun('too-large', 1);
    await post(r.taskIds[0], 'acknowledge', {}, fieldToken);
    await post(r.taskIds[0], 'start', {}, fieldToken);
    await post(r.taskIds[0], 'progress', { progress: 10 }, fieldToken);
    const page = (await (await eventsOf(r.situationId, '?type=TASK_PROGRESS_REPORTED')).json()) as {
      data: { items: Array<{ eventId: string }> };
    };

    const res = await api.call(
      'POST',
      `/api/v1/execution-events/${page.data.items[0].eventId}/corrections`,
      adminToken,
      {
        body: { reason: '큼', replacementFields: { note: 'x'.repeat(2_000_000) } },
        idempotencyKey: idem('huge'),
      },
    );
    // 500이 아니다 — 본문이 크다는 것은 서버 결함이 아니라 요청의 문제다.
    expect(res.status).toBe(413);
    expect(await errorCode(res)).toBe('COM-0413');
  });

  it('정정 값의 길이·중첩을 제한한다', async () => {
    // 사실원장은 append-only라 나중에 마스킹도 삭제도 할 수 없다.
    const r = await seedRun('value-limit', 1);
    await post(r.taskIds[0], 'acknowledge', {}, fieldToken);
    await post(r.taskIds[0], 'start', {}, fieldToken);
    await post(r.taskIds[0], 'progress', { progress: 10 }, fieldToken);
    const page = (await (await eventsOf(r.situationId, '?type=TASK_PROGRESS_REPORTED')).json()) as {
      data: { items: Array<{ eventId: string }> };
    };
    const target = page.data.items[0].eventId;

    let deep: unknown = 'x';
    for (let i = 0; i < 12; i += 1) deep = { nested: deep };
    const nested = await api.call(
      'POST',
      `/api/v1/execution-events/${target}/corrections`,
      adminToken,
      { body: { reason: '깊음', replacementFields: { note: deep } }, idempotencyKey: idem('d') },
    );
    expect(nested.status).toBe(409);

    const long = await api.call(
      'POST',
      `/api/v1/execution-events/${target}/corrections`,
      adminToken,
      {
        body: { reason: '김', replacementFields: { note: 'y'.repeat(5_000) } },
        idempotencyKey: idem('l'),
      },
    );
    expect(long.status).toBe(409);
  });

  it('임무 행을 손으로 바꿔도 판은 이벤트를 따른다', async () => {
    // **이것이 D1의 시험이다.** 임무 행을 정본으로 삼았다면 여기서 판이
    // 흔들린다.
    const r = await seedRun('source-of-truth', 1);
    await post(r.taskIds[0], 'acknowledge', {}, fieldToken);

    await withClient(h.dbUrl, (c) =>
      c.query(`UPDATE task SET status='COMPLETED', progress_pct=100 WHERE task_id=$1`, [
        r.taskIds[0],
      ]),
    );

    const body = (await (await dashboard(r.situationId)).json()) as {
      data: {
        kpi: Record<string, number>;
        tasks: Array<{ status: string }>;
        provenance: { divergences: unknown[] };
      };
    };
    // 이벤트는 ACKNOWLEDGED까지만 말했다.
    expect(body.data.tasks[0].status).toBe('ACKNOWLEDGED');
    expect(body.data.kpi.completed).toBe(0);
    expect(body.data.kpi.inProgress).toBe(1);
    // 그리고 판이 그 어긋남을 감추지 않는다.
    expect(body.data.provenance.divergences).toHaveLength(1);
  });

  it('`at`이 그 시점의 판을 낸다', async () => {
    const r = await seedRun('point-in-time', 1);
    const before = new Date();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await post(r.taskIds[0], 'acknowledge', {}, fieldToken);
    await post(r.taskIds[0], 'start', {}, fieldToken);

    const now = (await (await dashboard(r.situationId)).json()) as {
      data: { kpi: Record<string, number> };
    };
    expect(now.data.kpi.inProgress).toBe(1);

    const past = (await (
      await dashboard(r.situationId, `?at=${encodeURIComponent(before.toISOString())}`)
    ).json()) as { data: { kpi: Record<string, number>; at: string } };
    // 그때는 아직 수신확인 전이었다.
    expect(past.data.kpi.inProgress).toBe(0);
    expect(past.data.kpi.awaitingAck).toBe(1);
    expect(past.data.at).toBe(before.toISOString());
  });

  it('릴레이가 임무를 SENT로 올리면 사실원장에 남는다', async () => {
    // CC-290 전에는 이 전이가 이벤트 없이 일어나 재생이 그 임무를 영원히
    // CREATED로 봤다.
    const r = await seedRun('relay', 1);
    await withClient(h.dbUrl, (c) =>
      c.query(`UPDATE task SET status='CREATED' WHERE task_id=$1`, [r.taskIds[0]]),
    );
    const accepted = await api.call('POST', `/api/v1/tasks/${r.taskIds[0]}/dispatch`, adminToken, {
      body: { channels: ['SYSTEM'], recipients: [{ userId: h.fixtures.fieldA }] },
      idempotencyKey: idem('dispatch'),
    });
    expect(accepted.status).toBe(201);
    for (let i = 0; i < 4; i += 1) await h.outbox.runOnce();

    const rows = await withClient(
      h.dbUrl,
      async (c) =>
        (
          await c.query(
            `SELECT event_type, payload_json FROM execution_event
            WHERE aggregate_type='TASK' AND aggregate_id=$1 AND event_type='TASK_SENT'`,
            [r.taskIds[0]],
          )
        ).rows,
    );
    expect(rows).toHaveLength(1);
    expect((rows[0].payload_json as { status?: string }).status).toBe('SENT');
  });

  it('정정은 원본을 고치지 않고 새 이벤트를 더한다', async () => {
    const r = await seedRun('correct', 1);
    await post(r.taskIds[0], 'acknowledge', {}, fieldToken);
    await post(r.taskIds[0], 'start', {}, fieldToken);
    await post(r.taskIds[0], 'progress', { progress: 40, note: '절바' }, fieldToken);

    const page = (await (await eventsOf(r.situationId, '?type=TASK_PROGRESS_REPORTED')).json()) as {
      data: { items: Array<{ eventId: string; payload: Record<string, unknown> }> };
    };
    const original = page.data.items[0];
    expect(original.payload.note).toBe('절바');

    const res = await api.call(
      'POST',
      `/api/v1/execution-events/${original.eventId}/corrections`,
      adminToken,
      {
        body: { reason: '오타', replacementFields: { note: '절반' } },
        idempotencyKey: idem('correct'),
      },
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      data: { eventId: string; eventType: string; correctsEventId: string };
    };
    expect(created.data.eventType).toBe('EXECUTION_EVENT_CORRECTED');
    expect(created.data.correctsEventId).toBe(original.eventId);

    // 원본은 그대로다.
    const detail = (await (
      await api.call('GET', `/api/v1/execution-events/${original.eventId}`, adminToken)
    ).json()) as {
      data: {
        event: { payload: Record<string, unknown> };
        corrections: unknown[];
        effectivePayload: Record<string, unknown>;
      };
    };
    expect(detail.data.event.payload.note).toBe('절바');
    expect(detail.data.corrections).toHaveLength(1);
    // 지금 사실은 정정본이고, 건드리지 않은 값도 완성본에 남는다.
    expect(detail.data.effectivePayload.note).toBe('절반');
    expect(detail.data.effectivePayload.progressPct).toBe(40);
    expect(detail.data.effectivePayload.status).toBe('IN_PROGRESS');
  });

  it('정정의 정정을 막는다 — 원본을 다시 정정한다', async () => {
    const r = await seedRun('rechain', 1);
    await post(r.taskIds[0], 'acknowledge', {}, fieldToken);
    await post(r.taskIds[0], 'start', {}, fieldToken);
    await post(r.taskIds[0], 'progress', { progress: 10, note: 'a' }, fieldToken);

    const page = (await (await eventsOf(r.situationId, '?type=TASK_PROGRESS_REPORTED')).json()) as {
      data: { items: Array<{ eventId: string }> };
    };
    const original = page.data.items[0].eventId;

    const first = await api.call(
      'POST',
      `/api/v1/execution-events/${original}/corrections`,
      adminToken,
      { body: { reason: '1차', replacementFields: { note: 'b' } }, idempotencyKey: idem('c1') },
    );
    const firstId = ((await first.json()) as { data: { eventId: string } }).data.eventId;

    const chained = await api.call(
      'POST',
      `/api/v1/execution-events/${firstId}/corrections`,
      adminToken,
      { body: { reason: '2차', replacementFields: { note: 'c' } }, idempotencyKey: idem('c2') },
    );
    expect(chained.status).toBe(409);
    expect(await errorCode(chained)).toBe('EXEC-409-001');

    // 원본을 다시 정정하는 것은 된다. 그것이 유효본이 된다.
    const second = await api.call(
      'POST',
      `/api/v1/execution-events/${original}/corrections`,
      adminToken,
      { body: { reason: '2차', replacementFields: { note: 'c' } }, idempotencyKey: idem('c3') },
    );
    expect(second.status).toBe(201);
    const detail = (await (
      await api.call('GET', `/api/v1/execution-events/${original}`, adminToken)
    ).json()) as { data: { corrections: unknown[]; effectivePayload: { note: string } } };
    expect(detail.data.corrections).toHaveLength(2);
    expect(detail.data.effectivePayload.note).toBe('c');
  });

  it('시스템이 관측한 사실은 정정할 수 없다', async () => {
    const r = await seedRun('system-fact', 1);
    await post(r.taskIds[0], 'acknowledge', {}, fieldToken);

    const page = (await (await eventsOf(r.situationId, '?type=TASK_ACKNOWLEDGED')).json()) as {
      data: { items: Array<{ eventId: string }> };
    };
    const res = await api.call(
      'POST',
      `/api/v1/execution-events/${page.data.items[0].eventId}/corrections`,
      adminToken,
      { body: { reason: '고침', replacementFields: { note: 'x' } }, idempotencyKey: idem('c') },
    );
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('EXEC-409-001');
  });

  it('정정으로 status를 바꿀 수 없다', async () => {
    const r = await seedRun('protect', 1);
    await post(r.taskIds[0], 'acknowledge', {}, fieldToken);
    await post(r.taskIds[0], 'start', {}, fieldToken);
    await post(r.taskIds[0], 'progress', { progress: 10 }, fieldToken);

    const page = (await (await eventsOf(r.situationId, '?type=TASK_PROGRESS_REPORTED')).json()) as {
      data: { items: Array<{ eventId: string }> };
    };
    const res = await api.call(
      'POST',
      `/api/v1/execution-events/${page.data.items[0].eventId}/corrections`,
      adminToken,
      {
        body: { reason: '고침', replacementFields: { status: 'COMPLETED' } },
        idempotencyKey: idem('c'),
      },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { violations: { field: string }[] } };
    expect(body.error.violations.map((v) => v.field)).toContain('replacementFields.status');
  });

  it('원본 이벤트는 어떤 경로로도 바뀌지 않는다', async () => {
    const r = await seedRun('immutable', 1);
    await post(r.taskIds[0], 'acknowledge', {}, fieldToken);
    await expect(
      withClient(h.dbUrl, (c) =>
        c.query(`UPDATE execution_event SET payload_json='{}'::jsonb WHERE situation_id=$1`, [
          r.situationId,
        ]),
      ),
    ).rejects.toThrow(/수정·삭제할 수 없다/);
  });

  it('타임라인이 원본을 감추지 않는다', async () => {
    const r = await seedRun('timeline', 1);
    await post(r.taskIds[0], 'acknowledge', {}, fieldToken);
    await post(r.taskIds[0], 'start', {}, fieldToken);
    await post(r.taskIds[0], 'progress', { progress: 10, note: 'a' }, fieldToken);

    const page = (await (await eventsOf(r.situationId, '?type=TASK_PROGRESS_REPORTED')).json()) as {
      data: { items: Array<{ eventId: string }> };
    };
    const original = page.data.items[0].eventId;
    await api.call('POST', `/api/v1/execution-events/${original}/corrections`, adminToken, {
      body: { reason: '고침', replacementFields: { note: 'b' } },
      idempotencyKey: idem('c'),
    });

    const all = (await (await eventsOf(r.situationId, '?size=200')).json()) as {
      data: {
        items: Array<{ eventId: string; eventType: string; correctedBy: string | null }>;
      };
    };
    const originalRow = all.data.items.find((e) => e.eventId === original);
    // 원본이 목록에 그대로 있고 표시만 달린다.
    expect(originalRow).toBeDefined();
    expect(originalRow?.correctedBy).not.toBeNull();
    expect(all.data.items.some((e) => e.eventType === 'EXECUTION_EVENT_CORRECTED')).toBe(true);
  });

  it('필터가 실제로 좁힌다', async () => {
    const r = await seedRun('filter', 1);
    await post(r.taskIds[0], 'acknowledge', {}, fieldToken);
    await post(r.taskIds[0], 'start', {}, fieldToken);

    const typed = (await (await eventsOf(r.situationId, '?type=TASK_STARTED')).json()) as {
      data: { items: Array<{ eventType: string }>; total: number };
    };
    expect(typed.data.total).toBe(1);
    expect(typed.data.items[0].eventType).toBe('TASK_STARTED');

    const byAggregate = (await (
      await eventsOf(r.situationId, '?aggregateType=SOP_RUN')
    ).json()) as { data: { items: Array<{ aggregateType: string }> } };
    for (const item of byAggregate.data.items) expect(item.aggregateType).toBe('SOP_RUN');
  });

  it('조회 조건이 잘못되면 이유를 말한다', async () => {
    const r = await seedRun('bad-query', 1);
    const badAt = await dashboard(r.situationId, '?at=어제');
    expect(badAt.status).toBe(400);
    expect(await errorCode(badAt)).toBe('DASH-8001');

    const badRange = await eventsOf(
      r.situationId,
      '?from=2026-08-12T10:00:00.000Z&to=2026-08-12T09:00:00.000Z',
    );
    expect(badRange.status).toBe(400);
    expect(await errorCode(badRange)).toBe('EXEC-8002');
  });

  it('다른 기관의 판과 이벤트는 보이지 않는다', async () => {
    const r = await seedRun('tenant', 1);
    const board = await dashboard(r.situationId, '', otherToken);
    expect(board.status).toBe(404);
    expect(await errorCode(board)).toBe('SIT-404-001');

    await post(r.taskIds[0], 'acknowledge', {}, fieldToken);
    const page = (await (await eventsOf(r.situationId, '?type=TASK_ACKNOWLEDGED')).json()) as {
      data: { items: Array<{ eventId: string }> };
    };
    const detail = await api.call(
      'GET',
      `/api/v1/execution-events/${page.data.items[0].eventId}`,
      otherToken,
    );
    expect(detail.status).toBe(404);
    expect(await errorCode(detail)).toBe('EXEC-404-001');
  });

  it('현장 담당자에게는 정정 권한이 없다', async () => {
    const r = await seedRun('perm', 1);
    await post(r.taskIds[0], 'acknowledge', {}, fieldToken);
    await post(r.taskIds[0], 'start', {}, fieldToken);
    await post(r.taskIds[0], 'progress', { progress: 10 }, fieldToken);

    const page = (await (await eventsOf(r.situationId, '?type=TASK_PROGRESS_REPORTED')).json()) as {
      data: { items: Array<{ eventId: string }> };
    };
    const res = await api.call(
      'POST',
      `/api/v1/execution-events/${page.data.items[0].eventId}/corrections`,
      fieldToken,
      { body: { reason: '고침', replacementFields: { note: 'x' } }, idempotencyKey: idem('c') },
    );
    expect(res.status).toBe(403);
  });
});
