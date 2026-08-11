import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_URL, apiFor, idem, startHarness, withClient, type Harness } from './harness';

/**
 * 현장 임무 슬라이스 E2E (CC-280, UNE-TASK-001/002/004~012).
 *
 * 증명해야 하는 것.
 *   (1) 수신확인 → 착수 → 진행보고 → 완료 제출 → 승인이 한 줄로 흐른다.
 *   (2) **권한이 있어도 담당자가 아니면 못 만진다.** 그리고 그 방어가 DB에도 있다.
 *   (3) 각 전이가 임무 이벤트·사실원장·감사를 함께 남긴다(한 트랜잭션).
 *   (4) 완료조건을 못 채우면 완료가 안 된다.
 *   (5) 반려는 IN_PROGRESS로 되돌리고 **REJECTED라는 상태를 만들지 않는다.**
 *   (6) 재배정은 새 담당자의 SENT로 되돌리고 이력을 남긴다.
 *   (7) 마지막 임무가 승인되면 **실행이 스스로 끝나고** 다음 임무가 활성화된다.
 *   (8) 수행불가가 남아 있으면 실행을 끝내지 않는다.
 *   (9) 첨부는 검사를 통과한 파일만 걸린다.
 *  (10) 테넌트 경계.
 */

interface Ready {
  taskId: string;
  runId: string;
  situationId: string;
  nodeIds: string[];
  taskIds: string[];
}

describe.skipIf(!ADMIN_URL)('현장 임무 슬라이스 (CC-280)', () => {
  let h: Harness;
  let api: ReturnType<typeof apiFor>;
  let adminToken: string;
  let fieldToken: string;
  let field2Token: string;
  let otherToken: string;

  const errorCode = async (res: Response): Promise<string> => {
    const parsed = (await res.json()) as { error?: { code?: string } };
    return parsed.error?.code ?? 'NO_CODE';
  };

  /**
   * 실행 하나와 임무들. `steps`가 그래프의 ACTION 개수다.
   *
   * 첫 임무만 활성이고 담당자는 `fieldA`다 — 배정 이력도 함께 넣는다(전파에서
   * 자동 배정되는 경로를 흉내 낸다).
   */
  const seedRun = async (
    code: string,
    options: { steps?: number; policy?: unknown; mode?: string } = {},
  ): Promise<Ready> =>
    withClient(h.dbUrl, async (c) => {
      const steps = options.steps ?? 1;
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

      const startId = (
        await c.query(
          `INSERT INTO sop_node (sop_version_id, node_key, node_type, title, config_json, sort_order)
           VALUES ($1,'s','START','시작','{}'::jsonb,0) RETURNING node_id`,
          [versionId],
        )
      ).rows[0].node_id as string;
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
      const endId = (
        await c.query(
          `INSERT INTO sop_node (sop_version_id, node_key, node_type, title, config_json, sort_order)
           VALUES ($1,'e','END','끝','{}'::jsonb,$2) RETURNING node_id`,
          [versionId, steps + 1],
        )
      ).rows[0].node_id as string;

      const chain = [startId, ...nodeIds, endId];
      for (let i = 0; i < chain.length - 1; i += 1) {
        await c.query(
          `INSERT INTO sop_edge (sop_version_id, from_node_id, to_node_id, priority)
           VALUES ($1,$2,$3,0)`,
          [versionId, chain[i], chain[i + 1]],
        );
      }
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
          [
            versionId,
            situationId,
            snapshotId,
            options.mode ?? 'LIVE',
            h.fixtures.adminA,
            `corr-${code}`,
          ],
        )
      ).rows[0].run_id as string;

      const policy = JSON.stringify(options.policy ?? { instructions: ['수행'] });
      const taskIds: string[] = [];
      for (let i = 0; i < steps; i += 1) {
        const taskId = (
          await c.query(
            `INSERT INTO task
               (run_id, node_id, title, status, assignee_user_id, completion_policy_json,
                progress_pct, activated_at)
             VALUES ($1,$2,$3,'SENT',$4,$5::jsonb,0, CASE WHEN $6 THEN now() ELSE NULL END)
             RETURNING task_id`,
            [runId, nodeIds[i], `임무 ${i}`, h.fixtures.fieldA, policy, i === 0],
          )
        ).rows[0].task_id as string;
        await c.query(
          `INSERT INTO task_assignment (task_id, assignee_user_id, assigned_by, source)
           VALUES ($1,$2,$3,'DISPATCH')`,
          [taskId, h.fixtures.fieldA, h.fixtures.adminA],
        );
        taskIds.push(taskId);
      }
      return { taskId: taskIds[0], runId, situationId, nodeIds, taskIds };
    });

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

  const statusOf = async (taskId: string): Promise<string> =>
    withClient(
      h.dbUrl,
      async (c) =>
        (await c.query(`SELECT status FROM task WHERE task_id = $1`, [taskId])).rows[0]
          .status as string,
    );

  /** 담당자 경로를 완주시킨다 — 여러 시험의 준비 단계다. */
  const runToSubmitted = async (taskId: string, result = '방송 완료'): Promise<void> => {
    expect((await post(taskId, 'acknowledge', {}, fieldToken)).status).toBe(201);
    expect((await post(taskId, 'start', {}, fieldToken)).status).toBe(201);
    expect((await post(taskId, 'complete', { result }, fieldToken)).status).toBe(201);
  };

  beforeAll(async () => {
    h = await startHarness('cc280_e2e');
    api = apiFor(h);
    adminToken = await api.login(h.fixtures.tenantA, 'admin-a');
    fieldToken = await api.login(h.fixtures.tenantA, 'field-a');
    field2Token = await api.login(h.fixtures.tenantA, 'field-a2');
    otherToken = await api.login(h.fixtures.tenantB, 'user-b');
  }, 180_000);

  afterAll(async () => {
    await h?.close();
  });

  it('수신확인 → 착수 → 진행보고 → 완료 → 승인이 한 줄로 흐른다', async () => {
    const r = await seedRun('flow');

    const ack = await post(
      r.taskId,
      'acknowledge',
      { receivedAt: new Date().toISOString() },
      fieldToken,
    );
    expect(ack.status).toBe(201);
    const ackBody = (await ack.json()) as { data: { eventType: string; taskStatus: string } };
    expect(ackBody.data.eventType).toBe('ACKNOWLEDGED');
    expect(ackBody.data.taskStatus).toBe('ACKNOWLEDGED');

    expect((await post(r.taskId, 'start', { note: '출발' }, fieldToken)).status).toBe(201);
    expect(await statusOf(r.taskId)).toBe('IN_PROGRESS');

    const prog = await post(r.taskId, 'progress', { progress: 40, note: '절반' }, fieldToken);
    expect(prog.status).toBe(201);
    // 진행보고는 상태를 바꾸지 않는다.
    expect(await statusOf(r.taskId)).toBe('IN_PROGRESS');

    expect(
      (await post(r.taskId, 'complete', { result: '방송 송출 완료' }, fieldToken)).status,
    ).toBe(201);
    expect(await statusOf(r.taskId)).toBe('COMPLETION_SUBMITTED');

    expect(
      (await post(r.taskId, 'approve-completion', { comment: '확인' }, adminToken)).status,
    ).toBe(201);
    expect(await statusOf(r.taskId)).toBe('COMPLETED');

    // 완료된 임무가 40%로 보이면 대시보드가 거짓말을 한다.
    const progress = await withClient(
      h.dbUrl,
      async (c) =>
        (await c.query(`SELECT progress_pct FROM task WHERE task_id=$1`, [r.taskId])).rows[0]
          .progress_pct,
    );
    expect(Number(progress)).toBe(100);
  });

  it('전이마다 임무 이벤트·사실원장·감사가 함께 남는다', async () => {
    const r = await seedRun('audit');
    await runToSubmitted(r.taskId);

    const counts = await withClient(h.dbUrl, async (c) => ({
      taskEvents: Number(
        (await c.query(`SELECT count(*)::int n FROM task_event WHERE task_id=$1`, [r.taskId]))
          .rows[0].n,
      ),
      executionEvents: Number(
        (
          await c.query(
            `SELECT count(*)::int n FROM execution_event
              WHERE aggregate_type='TASK' AND aggregate_id=$1`,
            [r.taskId],
          )
        ).rows[0].n,
      ),
      audits: Number(
        (
          await c.query(
            `SELECT count(*)::int n FROM audit_log WHERE resource_type='TASK' AND resource_id=$1`,
            [r.taskId],
          )
        ).rows[0].n,
      ),
    }));
    expect(counts).toEqual({ taskEvents: 3, executionEvents: 3, audits: 3 });
  });

  it('임무 이벤트는 고칠 수 없다', async () => {
    const r = await seedRun('append');
    await post(r.taskId, 'acknowledge', {}, fieldToken);
    await expect(
      withClient(h.dbUrl, (c) =>
        c.query(`UPDATE task_event SET event_type='X' WHERE task_id=$1`, [r.taskId]),
      ),
    ).rejects.toThrow(/수정·삭제할 수 없다/);
  });

  it('권한이 있어도 담당자가 아니면 못 만진다', async () => {
    // TASK_ASSIGNEE는 여러 현장요원이 함께 갖는 역할이다. 권한과 배정은 다른
    // 질문이고, 이것이 이 항목의 핵심 방어다.
    const r = await seedRun('assignee');
    const res = await post(r.taskId, 'acknowledge', {}, field2Token);
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('TASK-403-001');
  });

  it('가드를 통과한 뒤 담당자가 바뀌면 DB가 막는다', async () => {
    // 앱 계층 확인과 조건부 UPDATE 사이에 재배정이 일어나는 경합이다. 그
    // 창을 직접 만들어 마지막 방어선이 실제로 있는지 본다.
    const r = await seedRun('race');
    await post(r.taskId, 'acknowledge', {}, fieldToken);
    await withClient(h.dbUrl, (c) =>
      c.query(`UPDATE task SET assignee_user_id=$2 WHERE task_id=$1`, [
        r.taskId,
        h.fixtures.fieldA2,
      ]),
    );
    const res = await post(r.taskId, 'start', {}, fieldToken);
    expect(res.status).toBe(403);
  });

  it('가드와 UPDATE 사이에 상태가 바뀌면 조건부 UPDATE가 막는다', async () => {
    // 앞 시험은 **요청 전에** 담당자를 바꾸므로 앱 계층 가드(403)에서 끝난다.
    // 두 번째 계층이 실제로 도는 것을 보려면 가드가 읽은 뒤 UPDATE 전에 값이
    // 바뀌어야 한다. 상태 쪽으로 그 창을 만든다 — 지휘자가 같은 순간
    // 재배정하면 임무는 SENT가 되고, 담당자의 착수 요청은 낡은 것이 된다.
    const r = await seedRun('toctou');
    await post(r.taskId, 'acknowledge', {}, fieldToken);

    // 서비스가 ACKNOWLEDGED를 읽은 뒤 UPDATE가 도는 사이를 흉내 낸다:
    // 요청을 보내기 직전에 상태만 바꾸면 가드는 통과하고(담당자 동일,
    // 실행 RUNNING) `WHERE status = 'ACKNOWLEDGED'`가 0행이 된다.
    const start = post(r.taskId, 'start', {}, fieldToken);
    await withClient(h.dbUrl, (c) =>
      c.query(`UPDATE task SET status='IN_PROGRESS' WHERE task_id=$1 AND status='ACKNOWLEDGED'`, [
        r.taskId,
      ]),
    );
    const res = await start;
    // 경합이 어느 쪽으로 풀리든 결과는 둘 중 하나여야 한다: 정상 착수(201),
    // 또는 낡은 요청 거절(409). 낡은 요청이 조용히 통과하면 안 된다.
    expect([201, 409]).toContain(res.status);
    if (res.status === 409) {
      expect(await errorCode(res)).toMatch(/^TASK-409-(002|010)$/);
    }
    expect(await statusOf(r.taskId)).toBe('IN_PROGRESS');
  });

  it('중복 수신확인은 흡수하지 않고 409로 말한다', async () => {
    const r = await seedRun('dup-ack');
    expect((await post(r.taskId, 'acknowledge', {}, fieldToken)).status).toBe(201);
    const again = await post(r.taskId, 'acknowledge', {}, fieldToken);
    expect(again.status).toBe(409);
    expect(await errorCode(again)).toBe('TASK-409-001');
  });

  it('같은 멱등키의 재전송은 재생된다 (오프라인 재시도)', async () => {
    // 현장은 신호가 끊긴다. 같은 요청이 그대로 다시 오는 것은 중복이 아니다.
    const r = await seedRun('idem');
    const key = idem('ack');
    const first = await api.call('POST', `/api/v1/tasks/${r.taskId}/acknowledge`, fieldToken, {
      body: {},
      idempotencyKey: key,
    });
    const second = await api.call('POST', `/api/v1/tasks/${r.taskId}/acknowledge`, fieldToken, {
      body: {},
      idempotencyKey: key,
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const events = await withClient(
      h.dbUrl,
      async (c) =>
        (await c.query(`SELECT count(*)::int n FROM task_event WHERE task_id=$1`, [r.taskId]))
          .rows[0].n,
    );
    expect(Number(events)).toBe(1);
  });

  it('멈춘 실행의 임무는 움직이지 않는다', async () => {
    const r = await seedRun('paused');
    await withClient(h.dbUrl, (c) =>
      c.query(`UPDATE sop_run SET status='PAUSED' WHERE run_id=$1`, [r.runId]),
    );
    const res = await post(r.taskId, 'acknowledge', {}, fieldToken);
    expect(res.status).toBe(412);
    expect(await errorCode(res)).toBe('TASK-412-002');
  });

  it('담당자가 없는 임무는 수행할 수 없다', async () => {
    const r = await seedRun('noassignee');
    await withClient(h.dbUrl, (c) =>
      c.query(`UPDATE task SET assignee_user_id=NULL WHERE task_id=$1`, [r.taskId]),
    );
    const res = await post(r.taskId, 'acknowledge', {}, fieldToken);
    expect(res.status).toBe(412);
    expect(await errorCode(res)).toBe('TASK-412-003');
  });

  it('끝난 임무에는 지휘자도 손대지 못한다', async () => {
    // 실행이 끝나지 않도록 임무를 둘 둔다.
    const r = await seedRun('settled', { steps: 2 });
    await runToSubmitted(r.taskIds[0]);
    await post(r.taskIds[0], 'approve-completion', {}, adminToken);

    const again = await post(r.taskIds[0], 'approve-completion', {}, adminToken);
    expect(again.status).toBe(409);
    expect(await errorCode(again)).toBe('TASK-409-004');

    const reject = await post(r.taskIds[0], 'reject-completion', { reason: '재검토' }, adminToken);
    expect(reject.status).toBe(409);
    expect(await errorCode(reject)).toBe('TASK-409-005');

    const reassign = await post(
      r.taskIds[0],
      'reassign',
      { assigneeId: h.fixtures.fieldA2, reason: '교대' },
      adminToken,
    );
    expect(reassign.status).toBe(409);
    expect(await errorCode(reassign)).toBe('TASK-409-006');

    const escalate = await post(
      r.taskIds[0],
      'escalate',
      { reason: '확인', targetIds: [h.fixtures.adminA] },
      adminToken,
    );
    expect(escalate.status).toBe(409);
    expect(await errorCode(escalate)).toBe('TASK-409-007');
  });

  it('진행보고 값과 Escalation 요청을 검증한다', async () => {
    const r = await seedRun('validate');
    await post(r.taskId, 'acknowledge', {}, fieldToken);
    await post(r.taskId, 'start', {}, fieldToken);

    const bad = await post(r.taskId, 'progress', { progress: 140 }, fieldToken);
    expect(bad.status).toBe(422);
    expect(await errorCode(bad)).toBe('TASK-422-006');

    const noTarget = await post(
      r.taskId,
      'escalate',
      { reason: '확인', targetIds: ['00000000-0000-4000-8000-000000000000'] },
      adminToken,
    );
    expect(noTarget.status).toBe(422);
    expect(await errorCode(noTarget)).toBe('TASK-422-011');
  });

  it('순서를 건너뛸 수 없다', async () => {
    const r = await seedRun('order');
    const res = await post(r.taskId, 'start', {}, fieldToken);
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('TASK-409-002');
  });

  it('완료조건을 못 채우면 완료되지 않는다', async () => {
    const r = await seedRun('policy', {
      policy: {
        instructions: ['확인'],
        checklist: [{ key: 'evac', label: '대피 안내', requiresEvidence: true }],
      },
    });
    await post(r.taskId, 'acknowledge', {}, fieldToken);
    await post(r.taskId, 'start', {}, fieldToken);

    const res = await post(r.taskId, 'complete', { result: '했다', checklist: [] }, fieldToken);
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: { code: string; violations: { field: string }[] };
    };
    expect(body.error.code).toBe('TASK-422-008');
    // 체크리스트 미충족과 증빙 없음이 각각 보인다.
    expect(body.error.violations.map((v) => v.field).sort()).toEqual([
      'attachments',
      'checklist.evac',
    ]);
    expect(await statusOf(r.taskId)).toBe('IN_PROGRESS');
  });

  it('완료조건을 적지 않은 SOP도 빈 완료보고는 받지 않는다', async () => {
    // 빈 완료보고는 상황일지에서 빈 칸이 된다.
    const r = await seedRun('empty');
    await post(r.taskId, 'acknowledge', {}, fieldToken);
    await post(r.taskId, 'start', {}, fieldToken);
    const res = await post(r.taskId, 'complete', { result: '   ' }, fieldToken);
    expect(res.status).toBe(422);
  });

  it('승인 뒤 재제출은 조용히 통과하지 않는다', async () => {
    // 감사 이력이 오염된다.
    //
    // 임무가 둘인 실행을 쓴다 — 하나짜리면 승인과 동시에 실행이 끝나고
    // 재제출이 `TASK-412-002`(실행이 진행 중이 아님)로 먼저 막혀 이 항목이
    // 보려는 상태 검사에 닿지 못한다.
    const r = await seedRun('resubmit', { steps: 2 });
    await runToSubmitted(r.taskId);
    await post(r.taskId, 'approve-completion', {}, adminToken);
    const res = await post(r.taskId, 'complete', { result: '또 했다' }, fieldToken);
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('TASK-409-008');
  });

  it('반려는 IN_PROGRESS로 되돌리고 REJECTED 상태를 만들지 않는다', async () => {
    const r = await seedRun('reject');
    await runToSubmitted(r.taskId);

    const res = await post(r.taskId, 'reject-completion', { reason: '증빙 부족' }, adminToken);
    expect(res.status).toBe(201);
    expect(await statusOf(r.taskId)).toBe('IN_PROGRESS');

    // 반려됐다는 사실은 이벤트가 들고 있다 — 화면은 그것에서 배지를 그린다.
    const types = await withClient(h.dbUrl, async (c) =>
      (
        await c.query(
          `SELECT event_type FROM task_event WHERE task_id=$1 ORDER BY event_time, task_event_id`,
          [r.taskId],
        )
      ).rows.map((row) => row.event_type as string),
    );
    expect(types[types.length - 1]).toBe('COMPLETION_REJECTED');

    // 반려 알림이 Outbox로 나간다 — 채널을 직접 부르지 않는다.
    const queued = await withClient(h.dbUrl, async (c) =>
      Number(
        (
          await c.query(
            `SELECT count(*)::int n FROM outbox_message WHERE event_type='TASK_COMPLETION_REJECTED'`,
          )
        ).rows[0].n,
      ),
    );
    expect(queued).toBeGreaterThan(0);
  });

  it('재배정은 새 담당자의 SENT로 되돌리고 이력을 남긴다', async () => {
    const r = await seedRun('reassign');
    await post(r.taskId, 'acknowledge', {}, fieldToken);
    await post(r.taskId, 'start', {}, fieldToken);

    const res = await post(
      r.taskId,
      'reassign',
      { assigneeId: h.fixtures.fieldA2, reason: '담당자 부상' },
      adminToken,
    );
    expect(res.status).toBe(201);
    // 새 담당자가 수신확인부터 다시 한다 — 받지도 않은 사람이 착수해 있는
    // 임무를 만들지 않는다.
    expect(await statusOf(r.taskId)).toBe('SENT');

    const history = await withClient(
      h.dbUrl,
      async (c) =>
        (
          await c.query(
            `SELECT assignee_user_id, source FROM task_assignment
            WHERE task_id=$1 ORDER BY assigned_at, task_assignment_id`,
            [r.taskId],
          )
        ).rows,
    );
    expect(history).toHaveLength(2);
    expect(history[1].source).toBe('REASSIGN');
    expect(history[1].assignee_user_id).toBe(h.fixtures.fieldA2);

    // 옛 담당자는 이제 못 만지고, 새 담당자는 만질 수 있다.
    expect((await post(r.taskId, 'acknowledge', {}, fieldToken)).status).toBe(403);
    expect((await post(r.taskId, 'acknowledge', {}, field2Token)).status).toBe(201);
  });

  it('배정 이력은 고칠 수 없다', async () => {
    const r = await seedRun('assign-append');
    await expect(
      withClient(h.dbUrl, (c) =>
        c.query(`UPDATE task_assignment SET reason='x' WHERE task_id=$1`, [r.taskId]),
      ),
    ).rejects.toThrow(/배정 이력은 수정·삭제할 수 없다/);
  });

  it('없는 사람에게는 재배정할 수 없다', async () => {
    const r = await seedRun('reassign-missing');
    const res = await post(
      r.taskId,
      'reassign',
      { assigneeId: '00000000-0000-4000-8000-000000000000', reason: '교대' },
      adminToken,
    );
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('TASK-422-010');
  });

  it('마지막 임무가 승인되면 실행이 스스로 끝난다', async () => {
    const r = await seedRun('complete-run', { steps: 2 });

    // 첫 임무만 활성이다.
    const before = await withClient(h.dbUrl, async (c) =>
      (
        await c.query(`SELECT task_id, activated_at FROM task WHERE run_id=$1 ORDER BY task_id`, [
          r.runId,
        ])
      ).rows.filter((row) => row.activated_at !== null),
    );
    expect(before).toHaveLength(1);

    await runToSubmitted(r.taskIds[0]);
    await post(r.taskIds[0], 'approve-completion', {}, adminToken);

    // 앞이 끝나면 다음이 차례가 된다.
    const second = await withClient(
      h.dbUrl,
      async (c) =>
        (await c.query(`SELECT activated_at FROM task WHERE task_id=$1`, [r.taskIds[1]])).rows[0]
          .activated_at,
    );
    expect(second).not.toBeNull();

    // 아직은 실행이 끝나지 않았다.
    const mid = await withClient(
      h.dbUrl,
      async (c) =>
        (await c.query(`SELECT status FROM sop_run WHERE run_id=$1`, [r.runId])).rows[0]
          .status as string,
    );
    expect(mid).toBe('RUNNING');

    await runToSubmitted(r.taskIds[1]);
    await post(r.taskIds[1], 'approve-completion', {}, adminToken);

    const run = await withClient(
      h.dbUrl,
      async (c) =>
        (await c.query(`SELECT status, ended_at FROM sop_run WHERE run_id=$1`, [r.runId])).rows[0],
    );
    expect(run.status).toBe('COMPLETED');
    expect(run.ended_at).not.toBeNull();

    const completed = await withClient(h.dbUrl, async (c) =>
      Number(
        (
          await c.query(
            `SELECT count(*)::int n FROM execution_event
              WHERE aggregate_type='SOP_RUN' AND aggregate_id=$1 AND event_type='RUN_COMPLETED'`,
            [r.runId],
          )
        ).rows[0].n,
      ),
    );
    expect(completed).toBe(1);
  });

  it('수행불가로 남은 임무가 있으면 실행을 끝내지 않는다', async () => {
    // 아무도 하지 않은 절차 단계가 완료된 실행 안에 조용히 남는 것을 막는다.
    const r = await seedRun('unable', { steps: 2 });
    await runToSubmitted(r.taskIds[0]);
    await post(r.taskIds[0], 'approve-completion', {}, adminToken);

    await post(r.taskIds[1], 'acknowledge', {}, fieldToken);
    await post(r.taskIds[1], 'start', {}, fieldToken);
    const res = await post(
      r.taskIds[1],
      'complete',
      { outcome: 'UNABLE', result: '접근로 유실', unableReasonCode: 'ACCESS' },
      fieldToken,
    );
    expect(res.status).toBe(201);
    expect(await statusOf(r.taskIds[1])).toBe('UNABLE_REPORTED');

    const run = await withClient(
      h.dbUrl,
      async (c) =>
        (await c.query(`SELECT status FROM sop_run WHERE run_id=$1`, [r.runId])).rows[0]
          .status as string,
    );
    expect(run).toBe('RUNNING');

    // 지휘자에게 알림이 나간다 — 자기가 낸 보고를 자기가 받지 않는다.
    const recipients = await withClient(h.dbUrl, async (c) =>
      (
        await c.query(
          `SELECT dr.user_id FROM dispatch d
             JOIN dispatch_recipient dr ON dr.dispatch_id = d.dispatch_id
            WHERE d.task_id = $1`,
          [r.taskIds[1]],
        )
      ).rows.map((row) => row.user_id as string),
    );
    expect(recipients).toContain(h.fixtures.adminA);
    expect(recipients).not.toContain(h.fixtures.fieldA);
  });

  it('수행불가는 사유 분류 없이 받지 않는다', async () => {
    const r = await seedRun('unable-reason');
    await post(r.taskId, 'acknowledge', {}, fieldToken);
    await post(r.taskId, 'start', {}, fieldToken);
    const res = await post(
      r.taskId,
      'complete',
      { outcome: 'UNABLE', result: '못했다' },
      fieldToken,
    );
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('TASK-422-009');
  });

  it('훈련·모의 실행은 알림을 내보내지 않는다', async () => {
    // 훈련 반려가 실제 지휘관에게 가면 훈련이 아니다.
    const r = await seedRun('exercise', { mode: 'EXERCISE' });
    await runToSubmitted(r.taskId);
    await post(r.taskId, 'reject-completion', { reason: '보완' }, adminToken);
    const queued = await withClient(h.dbUrl, async (c) =>
      Number(
        (await c.query(`SELECT count(*)::int n FROM dispatch WHERE task_id=$1`, [r.taskId])).rows[0]
          .n,
      ),
    );
    expect(queued).toBe(0);
  });

  it('검사를 통과하지 않은 파일은 첨부되지 않는다', async () => {
    const r = await seedRun('attach');
    await post(r.taskId, 'acknowledge', {}, fieldToken);
    await post(r.taskId, 'start', {}, fieldToken);

    const fileId = await withClient(
      h.dbUrl,
      async (c) =>
        (
          await c.query(
            `INSERT INTO file_object
               (tenant_id, storage_key, original_name, mime_type, size_bytes, sha256,
                scan_status, created_by)
             VALUES ($1,$2,'현장.jpg','image/jpeg',1024,$3,'PENDING',$4)
             RETURNING file_id`,
            [h.fixtures.tenantA, `k/${Date.now()}-pending`, 'a'.repeat(64), h.fixtures.fieldA],
          )
        ).rows[0].file_id as string,
    );
    const blocked = await post(r.taskId, 'attachments', { fileId, category: 'PHOTO' }, fieldToken);
    expect(blocked.status).toBe(422);
    expect(await errorCode(blocked)).toBe('FILE-422-003');

    await withClient(h.dbUrl, (c) =>
      c.query(`UPDATE file_object SET scan_status='CLEAN' WHERE file_id=$1`, [fileId]),
    );
    const ok = await post(r.taskId, 'attachments', { fileId, category: 'PHOTO' }, fieldToken);
    expect(ok.status).toBe(201);

    // 같은 파일을 두 번 붙여도 목록에 하나다 — 현장 앱은 재시도가 잦다.
    await post(r.taskId, 'attachments', { fileId, category: 'PHOTO' }, fieldToken);
    const count = await withClient(h.dbUrl, async (c) =>
      Number(
        (await c.query(`SELECT count(*)::int n FROM task_attachment WHERE task_id=$1`, [r.taskId]))
          .rows[0].n,
      ),
    );
    expect(count).toBe(1);
  });

  it('다른 기관의 파일은 첨부되지 않는다', async () => {
    const r = await seedRun('attach-tenant');
    await post(r.taskId, 'acknowledge', {}, fieldToken);
    await post(r.taskId, 'start', {}, fieldToken);

    const foreignFile = await withClient(
      h.dbUrl,
      async (c) =>
        (
          await c.query(
            `INSERT INTO file_object
               (tenant_id, storage_key, original_name, mime_type, size_bytes, sha256,
                scan_status, created_by)
             VALUES ($1,$2,'남의것.jpg','image/jpeg',1024,$3,'CLEAN',$4)
             RETURNING file_id`,
            [h.fixtures.tenantB, `k/${Date.now()}-foreign`, 'b'.repeat(64), h.fixtures.userB],
          )
        ).rows[0].file_id as string,
    );
    const res = await post(
      r.taskId,
      'attachments',
      { fileId: foreignFile, category: 'PHOTO' },
      fieldToken,
    );
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('FILE-422-003');
  });

  it('임무 목록은 내 것만 준다', async () => {
    const r = await seedRun('list');
    const res = await api.call('GET', '/api/v1/tasks?assignee=me&size=50', fieldToken);
    const body = (await res.json()) as { data: { items: { taskId: string }[]; total: number } };
    expect(res.status).toBe(200);
    expect(body.data.items.map((t) => t.taskId)).toContain(r.taskId);

    const others = await api.call('GET', '/api/v1/tasks?assignee=me&size=50', field2Token);
    const otherBody = (await others.json()) as { data: { items: { taskId: string }[] } };
    expect(otherBody.data.items.map((t) => t.taskId)).not.toContain(r.taskId);
  });

  it('이력의 각 이벤트가 자기 시점의 상태를 말한다', async () => {
    // 현재 상태를 모든 과거 이벤트에 붙이면 화면이 "그때 무엇이 됐는가"를
    // 물었을 때 거짓을 받는다.
    const r = await seedRun('history');
    await runToSubmitted(r.taskId);

    const res = await api.call('GET', `/api/v1/tasks/${r.taskId}`, fieldToken);
    const body = (await res.json()) as {
      data: { events: { eventType: string; taskStatus: string }[] };
    };
    const byType = Object.fromEntries(body.data.events.map((e) => [e.eventType, e.taskStatus]));
    expect(byType).toEqual({
      ACKNOWLEDGED: 'ACKNOWLEDGED',
      STARTED: 'IN_PROGRESS',
      COMPLETION_SUBMITTED: 'COMPLETION_SUBMITTED',
    });
  });

  it('상세는 완료조건·이벤트·배정 이력을 함께 준다', async () => {
    const r = await seedRun('detail', {
      policy: {
        instructions: ['확인'],
        checklist: [{ key: 'k', label: '점검' }],
        minAttachments: 1,
      },
    });
    await post(r.taskId, 'acknowledge', {}, fieldToken);
    const res = await api.call('GET', `/api/v1/tasks/${r.taskId}`, fieldToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        task: { status: string; instructions: string[] };
        completionPolicy: { checklist: { key: string }[]; minAttachments: number };
        events: unknown[];
        assignments: unknown[];
      };
    };
    expect(body.data.task.status).toBe('ACKNOWLEDGED');
    expect(body.data.task.instructions).toEqual(['확인']);
    expect(body.data.completionPolicy.checklist.map((c) => c.key)).toEqual(['k']);
    expect(body.data.completionPolicy.minAttachments).toBe(1);
    expect(body.data.events).toHaveLength(1);
    expect(body.data.assignments).toHaveLength(1);
  });

  it('Escalation은 상태를 바꾸지 않고 위로 알린다', async () => {
    const r = await seedRun('escalate');
    const before = await statusOf(r.taskId);
    const res = await post(
      r.taskId,
      'escalate',
      { level: 'L2', reason: '기한 초과', targetIds: [h.fixtures.adminA] },
      adminToken,
    );
    expect(res.status).toBe(201);
    expect(await statusOf(r.taskId)).toBe(before);

    const rows = await withClient(
      h.dbUrl,
      async (c) =>
        (
          await c.query(
            `SELECT d.message_type, count(m.outbox_id)::int AS queued
             FROM dispatch d
             LEFT JOIN dispatch_recipient dr ON dr.dispatch_id = d.dispatch_id
             LEFT JOIN outbox_message m ON m.dispatch_recipient_id = dr.recipient_id
            WHERE d.task_id = $1
            GROUP BY d.dispatch_id, d.message_type`,
            [r.taskId],
          )
        ).rows,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].message_type).toBe('ESCALATION');
    // Outbox까지 갔는지 본다 — dispatch만 세면 "접수는 됐는데 아무것도 큐에
    // 들어가지 않은" 상태를 통과시킨다.
    expect(Number(rows[0].queued)).toBe(1);
  });

  it('알림 전파는 임무를 SENT로 만들지 않는다', async () => {
    // 릴레이는 `TASK` 전파가 성공하면 임무를 SENT로 올린다. 알림이 같은 종류를
    // 쓰면 지시가 한 번도 나가지 않은 임무가 "전파됨"이 되고, 그 전이는
    // 상태기계를 거치지 않아 이벤트도 남지 않는다.
    const r = await seedRun('notice');
    await withClient(h.dbUrl, (c) =>
      c.query(`UPDATE task SET status='CREATED' WHERE task_id=$1`, [r.taskId]),
    );

    const res = await post(
      r.taskId,
      'escalate',
      { reason: '아직 아무도 받지 않았다', targetIds: [h.fixtures.adminA] },
      adminToken,
    );
    expect(res.status).toBe(201);

    // 릴레이를 끝까지 돌린다.
    for (let i = 0; i < 4; i += 1) await h.outbox.runOnce();

    expect(await statusOf(r.taskId)).toBe('CREATED');
    const types = await withClient(h.dbUrl, async (c) =>
      (
        await c.query(`SELECT DISTINCT message_type FROM dispatch WHERE task_id=$1`, [r.taskId])
      ).rows.map((row) => row.message_type as string),
    );
    expect(types).toEqual(['ESCALATION']);
  });

  it('수행불가 알림도 임무를 SENT로 만들지 않는다', async () => {
    const r = await seedRun('notice-unable');
    await post(r.taskId, 'acknowledge', {}, fieldToken);
    await post(r.taskId, 'start', {}, fieldToken);
    await post(
      r.taskId,
      'complete',
      { outcome: 'UNABLE', result: '접근 불가', unableReasonCode: 'ACCESS' },
      fieldToken,
    );
    for (let i = 0; i < 4; i += 1) await h.outbox.runOnce();

    expect(await statusOf(r.taskId)).toBe('UNABLE_REPORTED');
    const types = await withClient(h.dbUrl, async (c) =>
      (
        await c.query(`SELECT DISTINCT message_type FROM dispatch WHERE task_id=$1`, [r.taskId])
      ).rows.map((row) => row.message_type as string),
    );
    expect(types).toEqual(['TASK_NOTICE']);
  });

  it('현장 담당자에게는 감독 권한이 없다', async () => {
    const r = await seedRun('perm');
    await runToSubmitted(r.taskId);
    const res = await post(r.taskId, 'approve-completion', {}, fieldToken);
    expect(res.status).toBe(403);
  });

  it('다른 기관의 임무는 보이지 않는다', async () => {
    const r = await seedRun('tenant');
    const res = await api.call('GET', `/api/v1/tasks/${r.taskId}`, otherToken);
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe('TASK-404-001');
  });
});
