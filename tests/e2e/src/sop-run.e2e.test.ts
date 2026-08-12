import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_URL, apiFor, idem, startHarness, withClient, type Harness } from './harness';

/**
 * SOP 실행 슬라이스 E2E (CC-260, UNE-SOP-010~016).
 *
 * 증명해야 하는 것.
 *   (1) 승인된 버전을 실행하면 임무가 생기고 **첫 임무만 활성화**된다.
 *   (2) 모의 실행은 상황 상태를 건드리지 않고, 실제 실행과 나란히 돈다.
 *   (3) 승인되지 않은 버전·낡은 판으로는 시작하지 못한다.
 *   (4) 한 상황에 살아 있는 실제 실행은 하나다.
 *   (5) 일시중지·재개·강제종료가 상태기계대로만 간다.
 *   (6) 강제종료는 확인코드를 요구하고, 살아 있는 임무를 접고, **되돌릴 수 없다**.
 *   (7) 사실원장에 남고 SSE로 도착한다.
 *   (8) 권한·테넌트 경계.
 */

interface Fixture {
  sopId: string;
  versionId: string;
  situationId: string;
  snapshotId: string;
}

describe.skipIf(!ADMIN_URL)('SOP 실행 슬라이스 (CC-260)', () => {
  let h: Harness;
  let api: ReturnType<typeof apiFor>;
  let adminToken: string;
  let readerToken: string;
  let otherToken: string;

  const errorCode = async (res: Response): Promise<string> => {
    const parsed = (await res.json()) as { error?: { code?: string } };
    return parsed.error?.code ?? 'NO_CODE';
  };

  /**
   * 승인된 SOP 하나 (START → a → b → END).
   *
   * 승인 흐름은 CC-250 e2e가 증명했으므로 여기서는 SQL로 심는다 — 다시 태우면
   * 실패했을 때 "무엇이 깨졌나"가 흐려진다.
   */
  const seed = async (code: string, opts: { locked?: boolean } = {}): Promise<Fixture> =>
    withClient(h.dbUrl, async (c) => {
      const situationId = (
        await c.query(
          `INSERT INTO situation (tenant_id, mode, title, hazard_type, status, created_by)
           VALUES ($1,'LIVE',$2,'FLOOD','SOP_READY',$3) RETURNING situation_id`,
          [h.fixtures.tenantA, `상황 ${code}`, h.fixtures.adminA],
        )
      ).rows[0].situation_id as string;
      const snapshotId = (
        await c.query(
          `INSERT INTO situation_snapshot
             (situation_id, version_no, facts_json, content_hash, effective_at, confirmed_by)
           VALUES ($1, 1, '[{"factType":"DAMAGE","value":"침수"}]'::jsonb, $2, now(), $3)
           RETURNING snapshot_id`,
          [situationId, 'b'.repeat(64), h.fixtures.adminA],
        )
      ).rows[0].snapshot_id as string;
      await c.query(`UPDATE situation SET current_snapshot_id = $2 WHERE situation_id = $1`, [
        situationId,
        snapshotId,
      ]);

      const sopId = (
        await c.query(
          `INSERT INTO sop (tenant_id, situation_id, title, hazard_type, status, created_by)
           VALUES ($1,$2,$3,'FLOOD','APPROVED',$4) RETURNING sop_id`,
          [h.fixtures.tenantA, situationId, `SOP ${code}`, h.fixtures.adminA],
        )
      ).rows[0].sop_id as string;
      const versionId = (
        await c.query(
          `INSERT INTO sop_version
             (sop_id, version_no, status, graph_hash, schema_version, created_by)
           VALUES ($1, 1, 'DRAFT', $2, 'sop-editor-1', $3) RETURNING sop_version_id`,
          [sopId, 'c'.repeat(64), h.fixtures.adminA],
        )
      ).rows[0].sop_version_id as string;

      const nodeIds: Record<string, string> = {};
      const nodes: Array<[string, string, string, unknown]> = [
        ['s', 'START', '상황 접수', {}],
        [
          'a',
          'ACTION',
          '대피 방송',
          { tasks: [{ instruction: '방송 송출', assigneeHint: '상황실' }] },
        ],
        ['b', 'ACTION', '피해 집계', { tasks: [{ instruction: '집계 보고', assigneeHint: null }] }],
        ['e', 'END', '종료', {}],
      ];
      for (const [i, [key, type, title, config]] of nodes.entries()) {
        nodeIds[key] = (
          await c.query(
            `INSERT INTO sop_node (sop_version_id, node_key, node_type, title, config_json, sort_order)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING node_id`,
            [versionId, key, type, title, JSON.stringify(config), i + 1],
          )
        ).rows[0].node_id as string;
      }
      for (const [from, to] of [
        ['s', 'a'],
        ['a', 'b'],
        ['b', 'e'],
      ]) {
        await c.query(
          `INSERT INTO sop_edge (sop_version_id, from_node_id, to_node_id, priority)
           VALUES ($1,$2,$3,0)`,
          [versionId, nodeIds[from], nodeIds[to]],
        );
      }
      // 승인은 마지막에 — LOCKED가 되면 그래프를 더 못 넣는다(0035 §3).
      if (opts.locked !== false) {
        await c.query(
          `UPDATE sop_version SET status = 'LOCKED', approved_by = $2, approved_at = now()
            WHERE sop_version_id = $1`,
          [versionId, h.fixtures.adminA],
        );
        await c.query(`UPDATE sop SET current_version_id = $2 WHERE sop_id = $1`, [
          sopId,
          versionId,
        ]);
      }
      return { sopId, versionId, situationId, snapshotId };
    });

  const start = async (f: Fixture, mode: 'LIVE' | 'EXERCISE', token = adminToken) =>
    api.call('POST', `/api/v1/sops/${f.sopId}/runs`, token, {
      body: { approvedVersionId: f.versionId, snapshotId: f.snapshotId, mode },
      idempotencyKey: idem('run'),
    });

  const simulate = async (f: Fixture, token = adminToken) =>
    api.call('POST', `/api/v1/sops/${f.sopId}/simulations`, token, {
      body: { versionId: f.versionId, snapshotId: f.snapshotId, scenario: '야간 시나리오' },
      idempotencyKey: idem('sim'),
    });

  const situationStatus = async (situationId: string): Promise<string> =>
    withClient(
      h.dbUrl,
      async (c) =>
        (await c.query(`SELECT status FROM situation WHERE situation_id = $1`, [situationId]))
          .rows[0].status as string,
    );

  beforeAll(async () => {
    h = await startHarness('cc260_e2e');
    api = apiFor(h);
    adminToken = await api.login(h.fixtures.tenantA, 'admin-a');
    readerToken = await api.login(h.fixtures.tenantA, 'reader-a');
    otherToken = await api.login(h.fixtures.tenantB, 'user-b');
  }, 180_000);

  afterAll(async () => {
    if (h) await h.close();
  });

  it('(1) 실행을 시작하면 임무가 생기고 첫 임무만 활성화된다', async () => {
    const f = await seed('run-ok');
    const run = await api.json<{ data: { runId: string; status: string; mode: string } }>(
      await start(f, 'LIVE'),
      201,
    );
    expect(run.data.status).toBe('RUNNING');

    const detail = await api.json<{
      data: {
        tasks: Array<{
          nodeKey: string;
          status: string;
          activatedAt: string | null;
          instructions: string[];
        }>;
        activeNodeKeys: string[];
      };
    }>(await api.call('GET', `/api/v1/sop-runs/${run.data.runId}`, adminToken), 200);

    // ACTION 노드만 임무가 된다 — START/END는 흐름의 표시다.
    expect(detail.data.tasks.map((t) => t.nodeKey)).toEqual(['a', 'b']);
    expect(detail.data.tasks.every((t) => t.status === 'CREATED')).toBe(true);
    // **만들어진 임무와 지금 할 임무는 다르다.**
    expect(detail.data.activeNodeKeys).toEqual(['a']);
    expect(detail.data.tasks.find((t) => t.nodeKey === 'a')?.activatedAt).not.toBeNull();
    expect(detail.data.tasks.find((t) => t.nodeKey === 'b')?.activatedAt).toBeNull();
    // 노드가 적어 둔 임무 문구가 그대로 온다.
    expect(detail.data.tasks[0].instructions).toEqual(['방송 송출']);

    expect(await situationStatus(f.situationId)).toBe('RUNNING');
  }, 120_000);

  it('(2) 모의 실행은 상황을 건드리지 않고 실제 실행과 나란히 돈다', async () => {
    const f = await seed('run-dry');
    const sim = await api.json<{ data: { runId: string; status: string; mode: string } }>(
      await simulate(f),
      201,
    );
    // "시작했다"가 아니라 "준비됐다"다.
    expect(sim.data.status).toBe('READY');
    expect(sim.data.mode).toBe('DRY_RUN');
    // 모의 때문에 대시보드가 "대응 중"으로 보이면 안 된다.
    expect(await situationStatus(f.situationId)).toBe('SOP_READY');

    // 모의가 있어도 실제 실행을 시작할 수 있다.
    const live = await start(f, 'LIVE');
    expect(live.status).toBe(201);
    expect(await situationStatus(f.situationId)).toBe('RUNNING');

    // 모의도 임무를 만든다 — 그래야 무엇이 나갈지 미리 본다.
    const detail = await api.json<{ data: { tasks: unknown[] } }>(
      await api.call('GET', `/api/v1/sop-runs/${sim.data.runId}`, adminToken),
      200,
    );
    expect(detail.data.tasks).toHaveLength(2);
  }, 120_000);

  it('(3) 승인되지 않은 버전과 낡은 판을 거절한다', async () => {
    const draft = await seed('run-draft', { locked: false });
    const notApproved = await start(draft, 'LIVE');
    expect(notApproved.status).toBe(412);
    expect(await errorCode(notApproved)).toBe('SOP-412-004');

    const f = await seed('run-stale');
    const older = await withClient(
      h.dbUrl,
      async (c) =>
        (
          await c.query(
            `INSERT INTO situation_snapshot
               (situation_id, version_no, facts_json, content_hash, effective_at, confirmed_by)
             VALUES ($1, 2, '[{"factType":"DAMAGE","value":"옛판"}]'::jsonb, $2, now(), $3)
             RETURNING snapshot_id`,
            [f.situationId, 'd'.repeat(64), h.fixtures.adminA],
          )
        ).rows[0].snapshot_id as string,
    );
    const stale = await api.call('POST', `/api/v1/sops/${f.sopId}/runs`, adminToken, {
      body: { approvedVersionId: f.versionId, snapshotId: older, mode: 'LIVE' },
      idempotencyKey: idem('run'),
    });
    expect(stale.status).toBe(422);
    expect(await errorCode(stale)).toBe('SOP-422-008');
  }, 120_000);

  it('(4) 한 상황에 살아 있는 실제 실행은 하나다', async () => {
    const f = await seed('run-single');
    await api.json(await start(f, 'LIVE'), 201);
    const second = await start(f, 'EXERCISE');
    expect(second.status).toBe(409);
    expect(await errorCode(second)).toBe('SOP-409-005');
  }, 120_000);

  it('(5) 일시중지·재개가 상태기계대로만 간다', async () => {
    const f = await seed('run-control');
    const run = await api.json<{ data: { runId: string } }>(await start(f, 'LIVE'), 201);
    const runId = run.data.runId;

    const resumeFirst = await api.call('POST', `/api/v1/sop-runs/${runId}/resume`, adminToken, {
      body: {},
      idempotencyKey: idem('resume'),
    });
    // 돌고 있는 것을 재개할 수는 없다.
    expect(resumeFirst.status).toBe(409);
    expect(await errorCode(resumeFirst)).toBe('SOP-409-007');

    const paused = await api.json<{ data: { status: string } }>(
      await api.call('POST', `/api/v1/sop-runs/${runId}/pause`, adminToken, {
        body: { reason: '기상 악화' },
        idempotencyKey: idem('pause'),
      }),
      200,
    );
    expect(paused.data.status).toBe('PAUSED');

    const pauseAgain = await api.call('POST', `/api/v1/sop-runs/${runId}/pause`, adminToken, {
      body: {},
      idempotencyKey: idem('pause'),
    });
    expect(pauseAgain.status).toBe(409);

    const resumed = await api.json<{ data: { status: string } }>(
      await api.call('POST', `/api/v1/sop-runs/${runId}/resume`, adminToken, {
        body: {},
        idempotencyKey: idem('resume'),
      }),
      200,
    );
    expect(resumed.data.status).toBe('RUNNING');
  }, 120_000);

  it('(6) 강제종료는 확인코드를 요구하고 임무를 접으며 되돌릴 수 없다', async () => {
    const f = await seed('run-term');
    const run = await api.json<{ data: { runId: string } }>(await start(f, 'LIVE'), 201);
    const runId = run.data.runId;

    const wrongCode = await api.call('POST', `/api/v1/sop-runs/${runId}/terminate`, adminToken, {
      body: { confirmCode: 'nope' },
      idempotencyKey: idem('term'),
    });
    expect(wrongCode.status).toBe(400);
    expect(await errorCode(wrongCode)).toBe('SOP-400-003');

    const terminated = await api.json<{ data: { status: string; endedAt: string } }>(
      await api.call('POST', `/api/v1/sop-runs/${runId}/terminate`, adminToken, {
        body: { confirmCode: runId.slice(0, 8), reason: '상황 종료' },
        idempotencyKey: idem('term'),
      }),
      200,
    );
    expect(terminated.data.status).toBe('TERMINATED');
    expect(terminated.data.endedAt).not.toBeNull();

    const tasks = await withClient(h.dbUrl, async (c) =>
      (await c.query(`SELECT status FROM task WHERE run_id = $1`, [runId])).rows.map(
        (r) => r.status as string,
      ),
    );
    // 살아 있던 임무는 접힌다 — "그 임무는 왜 안 했는가"에 답이 남는다.
    expect(new Set(tasks)).toEqual(new Set(['CANCELLED']));

    for (const action of ['pause', 'resume', 'terminate']) {
      const res = await api.call(`POST`, `/api/v1/sop-runs/${runId}/${action}`, adminToken, {
        body: { confirmCode: runId.slice(0, 8) },
        idempotencyKey: idem(action),
      });
      expect(res.status, action).toBe(409);
    }

    // DB도 막는다 — 종료된 실행의 임무는 애플리케이션 밖에서도 못 바꾼다.
    const code = await withClient(h.dbUrl, async (c) => {
      try {
        await c.query('BEGIN');
        await c.query(`UPDATE task SET title = '조작' WHERE run_id = $1`, [runId]);
        await c.query('ROLLBACK');
        return 'NO_ERROR';
      } catch (err) {
        await c.query('ROLLBACK');
        return (err as { code?: string }).code ?? 'UNKNOWN';
      }
    });
    expect(code).toBe('42501');
  }, 120_000);

  it('(7) 사실원장에 남고 SSE로 도착한다', async () => {
    const f = await seed('run-sse');
    const run = await api.json<{ data: { runId: string } }>(await start(f, 'LIVE'), 201);
    const runId = run.data.runId;
    await api.call('POST', `/api/v1/sop-runs/${runId}/terminate`, adminToken, {
      body: { confirmCode: runId.slice(0, 8) },
      idempotencyKey: idem('term'),
    });

    const frames = await (
      await api.call('GET', `/api/v1/sop-runs/${runId}/events`, adminToken)
    ).text();
    for (const type of [
      'RUN_CREATED',
      'RUN_STARTED',
      'TASK_CREATED',
      'TASK_ACTIVATED',
      'RUN_TERMINATED',
    ]) {
      expect(frames, type).toContain(`event: ${type}`);
    }

    const stored = await withClient(h.dbUrl, async (c) =>
      (
        await c.query(
          `SELECT event_type, event_hash FROM execution_event
            WHERE aggregate_type = 'SOP_RUN' AND aggregate_id = $1 ORDER BY occurred_at`,
          [runId],
        )
      ).rows.map((r) => ({ type: r.event_type as string, hash: r.event_hash as string })),
    );
    expect(stored.length).toBeGreaterThanOrEqual(5);
    // 사실원장은 내용 지문을 함께 남긴다 — "이 줄이 그때 그대로인가".
    expect(stored.every((e) => /^[0-9a-f]{64}$/.test(e.hash))).toBe(true);

    // append-only: 정정은 새 이벤트다.
    const code = await withClient(h.dbUrl, async (c) => {
      try {
        await c.query('BEGIN');
        await c.query(
          `UPDATE execution_event SET payload_json = '{}'::jsonb WHERE aggregate_id = $1`,
          [runId],
        );
        await c.query('ROLLBACK');
        return 'NO_ERROR';
      } catch (err) {
        await c.query('ROLLBACK');
        return (err as { code?: string }).code ?? 'UNKNOWN';
      }
    });
    expect(code).toBe('42501');
  }, 120_000);

  it('(8) 권한과 테넌트 경계', async () => {
    const f = await seed('run-perm');
    const run = await api.json<{ data: { runId: string } }>(await start(f, 'LIVE'), 201);

    // VIEWER는 SOP_RUN도 SOP_RUN_CONTROL도 없다.
    expect((await start(f, 'LIVE', readerToken)).status).toBe(403);
    const control = await api.call(
      'POST',
      `/api/v1/sop-runs/${run.data.runId}/pause`,
      readerToken,
      { body: {}, idempotencyKey: idem('pause') },
    );
    expect(control.status).toBe(403);

    // 다른 기관에는 실행 자체가 보이지 않는다.
    const foreign = await api.call('GET', `/api/v1/sop-runs/${run.data.runId}`, otherToken);
    expect(foreign.status).toBe(404);
    expect(await errorCode(foreign)).toBe('SOP-404-004');
  }, 120_000);
});
