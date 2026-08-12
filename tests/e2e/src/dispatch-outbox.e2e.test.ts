import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_URL, apiFor, idem, startHarness, withClient, type Harness } from './harness';

/**
 * 전파·Outbox 슬라이스 E2E (CC-270, UNE-TASK-003/013/014).
 *
 * 증명해야 하는 것.
 *   (1) **원자적 쓰기** — 전파·수신자·Outbox·사실원장이 한 트랜잭션이다.
 *   (2) 릴레이가 보내고 수신자·전파·임무 상태가 따라 움직인다.
 *   (3) **중복 억제** — 같은 전파를 두 번 접수해도 Outbox는 한 줄이다.
 *   (4) 재시도·백오프 — 일시 장애는 다시 예약되고, 시도를 다 쓰면 dead letter다.
 *   (5) 다시 보내도 같은 실패는 **바로** dead letter다.
 *   (6) 부분 실패는 PARTIAL이고, 재전파는 dead letter만 되살린다.
 *   (7) 모의 실행에서는 전파하지 않는다.
 *   (8) 시뮬레이션임이 결과에 드러난다.
 */

interface Ready {
  taskId: string;
  runId: string;
  situationId: string;
}

describe.skipIf(!ADMIN_URL)('전파·Outbox 슬라이스 (CC-270)', () => {
  let h: Harness;
  let api: ReturnType<typeof apiFor>;
  let adminToken: string;
  let otherToken: string;

  const errorCode = async (res: Response): Promise<string> => {
    const parsed = (await res.json()) as { error?: { code?: string } };
    return parsed.error?.code ?? 'NO_CODE';
  };

  /** 승인된 SOP를 실행해 임무 하나를 활성 상태로 만든다. */
  const seedRunningTask = async (code: string, mode = 'LIVE'): Promise<Ready> =>
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
      const nodeId = (
        await c.query(
          `INSERT INTO sop_node (sop_version_id, node_key, node_type, title, config_json, sort_order)
           VALUES ($1,'a','ACTION','대피 방송',$2::jsonb,1) RETURNING node_id`,
          [
            versionId,
            JSON.stringify({ tasks: [{ instruction: '방송 송출', assigneeHint: null }] }),
          ],
        )
      ).rows[0].node_id as string;
      await c.query(
        `UPDATE sop_version SET status='LOCKED', approved_by=$2, approved_at=now()
          WHERE sop_version_id=$1`,
        [versionId, h.fixtures.adminA],
      );

      const runId = (
        await c.query(
          `INSERT INTO sop_run
             (sop_version_id, situation_id, snapshot_id, mode, status, started_by, correlation_id)
           VALUES ($1,$2,$3,$4,'RUNNING',$5,$6) RETURNING run_id`,
          [versionId, situationId, snapshotId, mode, h.fixtures.adminA, `corr-${code}`],
        )
      ).rows[0].run_id as string;
      const taskId = (
        await c.query(
          `INSERT INTO task (run_id, node_id, title, status, completion_policy_json, progress_pct, activated_at)
           VALUES ($1,$2,'대피 방송','CREATED','{"instructions":["방송 송출"]}'::jsonb,0,now())
           RETURNING task_id`,
          [runId, nodeId],
        )
      ).rows[0].task_id as string;
      return { taskId, runId, situationId };
    });

  const dispatch = async (
    r: Ready,
    body: Record<string, unknown>,
    token = adminToken,
  ): Promise<Response> =>
    api.call('POST', `/api/v1/tasks/${r.taskId}/dispatch`, token, {
      body,
      idempotencyKey: idem('dispatch'),
    });

  const outboxRows = async (dispatchId: string) =>
    withClient(
      h.dbUrl,
      async (c) =>
        (
          await c.query(
            `SELECT m.outbox_id, m.status, m.attempt_count, m.next_attempt_at, m.channel
             FROM outbox_message m
             JOIN dispatch_recipient dr ON dr.recipient_id = m.dispatch_recipient_id
            WHERE dr.dispatch_id = $1 ORDER BY m.channel`,
            [dispatchId],
          )
        ).rows,
    );

  /** 릴레이를 여러 번 돌린다 — 백오프가 걸리면 시각을 당겨 다음 시도를 부른다. */
  const drain = async (rounds = 8): Promise<void> => {
    for (let i = 0; i < rounds; i += 1) {
      await h.outbox.runOnce();
      await withClient(h.dbUrl, (c) =>
        c.query(`UPDATE outbox_message SET next_attempt_at = now() WHERE status = 'FAILED'`),
      );
    }
  };

  beforeAll(async () => {
    h = await startHarness('cc270_e2e');
    api = apiFor(h);
    adminToken = await api.login(h.fixtures.tenantA, 'admin-a');
    otherToken = await api.login(h.fixtures.tenantB, 'user-b');
  }, 180_000);

  afterAll(async () => {
    if (h) await h.close();
  });

  it('(1) 전파·수신자·Outbox·사실원장이 한 트랜잭션이다', async () => {
    const r = await seedRunningTask('atomic');
    const created = await api.json<{ data: { dispatchId: string; recipients: unknown[] } }>(
      await dispatch(r, {
        channels: ['SYSTEM', 'SMS'],
        recipients: [{ userId: h.fixtures.readerA }],
      }),
      201,
    );
    // 채널 둘 × 수신자 하나 = 수신자 행 둘.
    expect(created.data.recipients).toHaveLength(2);

    const rows = await withClient(h.dbUrl, async (c) => ({
      outbox: (await outboxRows(created.data.dispatchId)).length,
      events: (
        await c.query(
          `SELECT count(*)::int n FROM execution_event
            WHERE aggregate_type = 'DISPATCH' AND aggregate_id = $1`,
          [created.data.dispatchId],
        )
      ).rows[0].n,
      audit: (
        await c.query(`SELECT count(*)::int n FROM audit_log WHERE resource_id = $1`, [
          created.data.dispatchId,
        ])
      ).rows[0].n,
    }));
    expect(rows).toEqual({ outbox: 2, events: 1, audit: 1 });
  }, 120_000);

  it('(2) 릴레이가 보내면 수신자·전파·임무가 따라 움직인다', async () => {
    const r = await seedRunningTask('relay');
    const created = await api.json<{ data: { dispatchId: string } }>(
      await dispatch(r, { channels: ['SYSTEM'], recipients: [{ userId: h.fixtures.readerA }] }),
      201,
    );
    await drain(2);

    const status = await api.json<{
      data: {
        status: string;
        recipients: Array<{ deliveryStatus: string }>;
        attempts: Array<{ resultStatus: string; providerMessageId: string | null }>;
      };
    }>(await api.call('GET', `/api/v1/dispatches/${created.data.dispatchId}`, adminToken), 200);

    expect(status.data.status).toBe('SENT');
    expect(status.data.recipients[0].deliveryStatus).toBe('SENT');
    expect(status.data.attempts[0].resultStatus).toBe('SUCCESS');
    expect(status.data.attempts[0].providerMessageId).not.toBeNull();

    const taskStatus = await withClient(
      h.dbUrl,
      async (c) =>
        (await c.query(`SELECT status FROM task WHERE task_id = $1`, [r.taskId])).rows[0].status,
    );
    expect(taskStatus).toBe('SENT');
  }, 120_000);

  it('(3) 같은 전파를 두 번 접수해도 Outbox는 한 줄이다', async () => {
    const r = await seedRunningTask('dup');
    const key = idem('dispatch-same');
    const first = await api.json<{ data: { dispatchId: string } }>(
      await api.call('POST', `/api/v1/tasks/${r.taskId}/dispatch`, adminToken, {
        body: { channels: ['SMS'], recipients: [{ userId: h.fixtures.readerA }] },
        idempotencyKey: key,
      }),
      201,
    );
    const second = await api.json<{ data: { dispatchId: string } }>(
      await api.call('POST', `/api/v1/tasks/${r.taskId}/dispatch`, adminToken, {
        body: { channels: ['SMS'], recipients: [{ userId: h.fixtures.readerA }] },
        idempotencyKey: key,
      }),
      201,
    );
    // 멱등키가 같으면 같은 전파다.
    expect(second.data.dispatchId).toBe(first.data.dispatchId);
    expect(await outboxRows(first.data.dispatchId)).toHaveLength(1);
  }, 120_000);

  it('(4) 일시 장애는 재시도하고, 시도를 다 쓰면 dead letter다', async () => {
    const r = await seedRunningTask('retry');
    const created = await api.json<{ data: { dispatchId: string } }>(
      await dispatch(r, {
        channels: ['SMS'],
        // 시나리오 훅이 켜져 있을 때만 동작한다(설정으로만 — ADR-33 D19).
        recipients: [{ userId: h.fixtures.readerA }],
        messageTemplate: '.channel-down. 테스트',
      }),
      201,
    );
    // 시나리오는 수신자 참조로 고른다 — 본문이 아니라. 여기서는 직접 심는다.
    await withClient(h.dbUrl, (c) =>
      c.query(
        `UPDATE outbox_message
            SET payload_json = jsonb_set(payload_json, '{recipientRef}', '".channel-down."')
          WHERE dispatch_recipient_id IN (
            SELECT recipient_id FROM dispatch_recipient WHERE dispatch_id = $1)`,
        [created.data.dispatchId],
      ),
    );

    await h.outbox.runOnce();
    const afterFirst = await outboxRows(created.data.dispatchId);
    // 첫 실패는 재시도 예약이다 — 다음 시도 시각이 잡힌다.
    expect(afterFirst[0].status).toBe('FAILED');
    expect(afterFirst[0].next_attempt_at).not.toBeNull();
    expect(Number(afterFirst[0].attempt_count)).toBe(1);

    await drain(8);
    const settled = await outboxRows(created.data.dispatchId);
    expect(settled[0].status).toBe('DEAD_LETTER');
    // 시도 상한을 넘겨 무한히 돌지 않는다.
    expect(Number(settled[0].attempt_count)).toBeLessThanOrEqual(6);

    const status = await api.json<{ data: { status: string } }>(
      await api.call('GET', `/api/v1/dispatches/${created.data.dispatchId}`, adminToken),
      200,
    );
    expect(status.data.status).toBe('FAILED');
  }, 120_000);

  it('(5) 다시 보내도 같은 실패는 바로 dead letter다', async () => {
    const r = await seedRunningTask('reject');
    const created = await api.json<{ data: { dispatchId: string } }>(
      await dispatch(r, { channels: ['SMS'], recipients: [{ userId: h.fixtures.readerA }] }),
      201,
    );
    await withClient(h.dbUrl, (c) =>
      c.query(
        `UPDATE outbox_message
            SET payload_json = jsonb_set(payload_json, '{recipientRef}', '".bad-address."')
          WHERE dispatch_recipient_id IN (
            SELECT recipient_id FROM dispatch_recipient WHERE dispatch_id = $1)`,
        [created.data.dispatchId],
      ),
    );
    await h.outbox.runOnce();

    const rows = await outboxRows(created.data.dispatchId);
    // 주소 오류를 다시 던지는 것은 채널 부하만 만든다.
    expect(rows[0].status).toBe('DEAD_LETTER');
    expect(Number(rows[0].attempt_count)).toBe(1);
  }, 120_000);

  it('(6) 부분 실패는 PARTIAL이고 재전파는 dead letter만 되살린다', async () => {
    const r = await seedRunningTask('partial');
    const created = await api.json<{ data: { dispatchId: string } }>(
      await dispatch(r, {
        channels: ['SYSTEM', 'SMS'],
        recipients: [{ userId: h.fixtures.readerA }],
      }),
      201,
    );
    await withClient(h.dbUrl, (c) =>
      c.query(
        `UPDATE outbox_message
            SET payload_json = jsonb_set(payload_json, '{recipientRef}', '".bad-address."')
          WHERE channel = 'SMS'
            AND dispatch_recipient_id IN (
              SELECT recipient_id FROM dispatch_recipient WHERE dispatch_id = $1)`,
        [created.data.dispatchId],
      ),
    );
    await drain(3);

    const status = await api.json<{ data: { status: string } }>(
      await api.call('GET', `/api/v1/dispatches/${created.data.dispatchId}`, adminToken),
      200,
    );
    // 절반이 받았는데 "실패"로 보이면 운영자가 전부 다시 보낸다.
    expect(status.data.status).toBe('PARTIAL');

    const retried = await api.json<{ data: { status: string } }>(
      await api.call('POST', `/api/v1/dispatches/${created.data.dispatchId}/retry`, adminToken, {
        body: {},
        idempotencyKey: idem('retry'),
      }),
      200,
    );
    expect(retried.data.status).toBe('SENDING');

    const after = await outboxRows(created.data.dispatchId);
    // 성공한 줄은 건드리지 않는다 — 다시 보내면 같은 지시를 두 번 받는다.
    expect(after.filter((x) => x.status === 'SENT')).toHaveLength(1);
    expect(after.filter((x) => x.status === 'PENDING')).toHaveLength(1);

    const nothing = await api.call(
      'POST',
      `/api/v1/dispatches/${created.data.dispatchId}/retry`,
      adminToken,
      { body: {}, idempotencyKey: idem('retry') },
    );
    expect(nothing.status).toBe(409);
    expect(await errorCode(nothing)).toBe('DISP-409-001');
  }, 120_000);

  it('(7) 모의·훈련 실행에서는 전파하지 않는다', async () => {
    for (const mode of ['DRY_RUN', 'EXERCISE']) {
      const r = await seedRunningTask(`no-dispatch-${mode}`, mode);
      const res = await dispatch(r, {
        channels: ['SMS'],
        recipients: [{ userId: h.fixtures.readerA }],
      });
      // 훈련이 실제 문자를 보내면 훈련이 아니다.
      expect(res.status, mode).toBe(412);
      expect(await errorCode(res)).toBe('TASK-412-001');
    }
  }, 120_000);

  it('(8) 시뮬레이션임이 결과에 드러난다', async () => {
    const r = await seedRunningTask('simulated');
    const created = await api.json<{
      data: { dispatchId: string; recipients: Array<{ channel: string; simulated: boolean }> };
    }>(
      await dispatch(r, {
        channels: ['SYSTEM', 'SMS'],
        recipients: [{ userId: h.fixtures.readerA }],
      }),
      201,
    );
    // 접수 응답에서 이미 갈린다.
    const byChannel = Object.fromEntries(
      created.data.recipients.map((x) => [x.channel, x.simulated]),
    );
    expect(byChannel).toEqual({ SYSTEM: false, SMS: true });

    await drain(2);
    const status = await api.json<{
      data: { attempts: Array<{ channel: string; simulated: boolean | null }> };
    }>(await api.call('GET', `/api/v1/dispatches/${created.data.dispatchId}`, adminToken), 200);
    const attempts = Object.fromEntries(status.data.attempts.map((a) => [a.channel, a.simulated]));
    // 시도 기록에도 남는다 — 나중에 이 줄을 보고 "전파됐다"고 읽으면 안 된다.
    expect(attempts).toEqual({ SYSTEM: false, SMS: true });
  }, 120_000);

  it('(9) 권한과 테넌트 경계', async () => {
    const r = await seedRunningTask('perm');
    const created = await api.json<{ data: { dispatchId: string } }>(
      await dispatch(r, { channels: ['SYSTEM'], recipients: [{ userId: h.fixtures.readerA }] }),
      201,
    );
    const foreign = await api.call(
      'GET',
      `/api/v1/dispatches/${created.data.dispatchId}`,
      otherToken,
    );
    expect(foreign.status).toBe(404);
    expect(await errorCode(foreign)).toBe('DISP-404-001');
  }, 120_000);
});
