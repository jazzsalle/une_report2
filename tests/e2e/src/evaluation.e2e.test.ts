import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertMatchesSchema } from './contract-conformance';
import { ADMIN_URL, apiFor, idem, startHarness, withClient, type Harness } from './harness';

/**
 * 훈련 종료·평가 슬라이스 E2E (CC-310, UNE-JNL-012~015).
 *
 * 증명해야 하는 것.
 *   (1) 미결이 있으면 **목록과 함께** 막힌다.
 *   (2) 처분에 **사유가 없으면** 닫히지 않는다.
 *   (3) 닫으면 기준선 해시가 사실원장에 남는다.
 *   (4) **닫힌 뒤 새 사실은 못 쓰고 정정은 쓸 수 있다** — 이 항목의 핵심 함정.
 *   (5) 종료된 훈련만 평가할 수 있다.
 *   (6) 근거가 이 훈련의 것이 아니면 거절한다.
 *   (7) 지표는 고정되고, 정정이 붙으면 낡았다고 말한다(자동 재산출 없음).
 *   (8) 개선조치는 대상을 가리키기만 하고 바꾸지 않는다.
 *   (9) 확정된 평가는 얼어붙는다 — DB도 막는다.
 *  (10) 보고서가 빈 자리를 말로 채운다.
 *  (11) 권한·상태·멱등·감사·테넌트 경계.
 */

interface Ready {
  situationId: string;
  snapshotId: string;
  runId: string;
  taskId: string;
  eventId: string;
  sopId: string;
}

describe.skipIf(!ADMIN_URL)('훈련 종료·평가 슬라이스 (CC-310)', () => {
  let h: Harness;
  let api: ReturnType<typeof apiFor>;
  let adminToken: string;
  let otherToken: string;

  const errorCode = async (res: Response): Promise<string> => {
    const parsed = (await res.json()) as { error?: { code?: string } };
    return parsed.error?.code ?? 'NO_CODE';
  };

  /** 끝난 훈련 하나. 실행은 완료돼 있고 임무도 정리돼 있다. */
  const seed = async (code: string, opts: { settled?: boolean } = {}): Promise<Ready> =>
    withClient(h.dbUrl, async (c) => {
      const settled = opts.settled !== false;
      const situationId = (
        await c.query(
          `INSERT INTO situation (tenant_id, mode, title, hazard_type, status, created_by)
           VALUES ($1,'EXERCISE',$2,'FLOOD','RUNNING',$3) RETURNING situation_id`,
          [h.fixtures.tenantA, `훈련 ${code}`, h.fixtures.adminA],
        )
      ).rows[0].situation_id as string;
      const snapshotId = (
        await c.query(
          `INSERT INTO situation_snapshot
             (situation_id, version_no, facts_json, content_hash, effective_at, confirmed_by)
           VALUES ($1,1,'[{"factType":"DAMAGE"}]'::jsonb,$2,now(),$3) RETURNING snapshot_id`,
          [situationId, 'a'.repeat(64), h.fixtures.adminA],
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
          [sopId, 'b'.repeat(64), h.fixtures.adminA],
        )
      ).rows[0].sop_version_id as string;
      const nodeId = (
        await c.query(
          `INSERT INTO sop_node (sop_version_id, node_key, node_type, title, config_json, sort_order)
           VALUES ($1,'a0','ACTION','대피 방송','{}'::jsonb,1) RETURNING node_id`,
          [versionId],
        )
      ).rows[0].node_id as string;
      await c.query(
        `UPDATE sop_version SET status='LOCKED', approved_by=$2, approved_at=now()
          WHERE sop_version_id=$1`,
        [versionId, h.fixtures.adminA],
      );
      // **실행은 RUNNING으로 만든 뒤에 접는다.** 0039의 트리거가 끝난 실행의
      // 임무 쓰기를 막으므로, 임무를 먼저 넣고 마지막에 실행을 완료시킨다.
      const runId = (
        await c.query(
          `INSERT INTO sop_run
             (sop_version_id, situation_id, snapshot_id, mode, status, started_by, correlation_id)
           VALUES ($1,$2,$3,'EXERCISE','RUNNING',$4,$5) RETURNING run_id`,
          [versionId, situationId, snapshotId, h.fixtures.adminA, `corr-${code}`],
        )
      ).rows[0].run_id as string;
      const taskId = (
        await c.query(
          `INSERT INTO task
             (run_id, node_id, title, status, assignee_user_id, completion_policy_json,
              progress_pct, activated_at)
           VALUES ($1,$2,'대피 방송','SENT',$3,'{}'::jsonb,0,now()) RETURNING task_id`,
          [runId, nodeId, h.fixtures.fieldA],
        )
      ).rows[0].task_id as string;
      if (settled) {
        await c.query(`UPDATE task SET status='COMPLETED', progress_pct=100 WHERE task_id=$1`, [
          taskId,
        ]);
      }

      const event = async (type: string, payload: Record<string, unknown>, hash: string) =>
        (
          await c.query(
            `INSERT INTO execution_event
               (tenant_id, situation_id, aggregate_type, aggregate_id, event_type,
                actor_id, payload_json, correlation_id, event_hash)
             VALUES ($1,$2,'TASK',$3,$4,$5,$6::jsonb,$7,$8)
             RETURNING execution_event_id`,
            [
              h.fixtures.tenantA,
              situationId,
              taskId,
              type,
              h.fixtures.adminA,
              JSON.stringify(payload),
              `corr-${code}`,
              hash,
            ],
          )
        ).rows[0].execution_event_id as string;

      const eventId = await event('TASK_CREATED', { status: 'SENT', runId }, '1'.repeat(64));
      if (settled) {
        await event('TASK_COMPLETED', { status: 'COMPLETED', runId }, '2'.repeat(64));
        await c.query(`UPDATE sop_run SET status='COMPLETED', ended_at=now() WHERE run_id=$1`, [
          runId,
        ]);
      }
      return { situationId, snapshotId, runId, taskId, eventId, sopId };
    });

  const preview = async (r: Ready, token = adminToken): Promise<Response> =>
    api.call('GET', `/api/v1/situations/${r.situationId}/close-preview`, token);

  const close = async (
    r: Ready,
    dispositions: Array<{ refId: string; disposition: string; reason: string }> = [],
    token = adminToken,
  ): Promise<Response> =>
    api.call('POST', `/api/v1/situations/${r.situationId}/close`, token, {
      body: { resultSummary: '훈련 종료', dispositions },
      idempotencyKey: idem('close'),
    });

  const evaluate = async (
    r: Ready,
    scores: Array<Record<string, unknown>>,
    token = adminToken,
  ): Promise<Response> =>
    api.call('POST', `/api/v1/situations/${r.situationId}/evaluations`, token, {
      body: { summary: '대체로 계획대로 진행됨', scores },
      idempotencyKey: idem('evaluate'),
    });

  const evaluationOf = async (r: Ready): Promise<string> => {
    const res = await evaluate(r, [
      {
        criterionCode: 'DISPATCH_TIME',
        scoreValue: 80,
        weightValue: 1,
        comment: '전파는 기준 안에 들어왔다.',
        evidenceEventIds: [r.eventId],
      },
    ]);
    expect(res.status, await res.clone().text()).toBe(201);
    return ((await res.json()) as { data: { evaluationId: string } }).data.evaluationId;
  };

  beforeAll(async () => {
    h = await startHarness('cc310_e2e');
    api = apiFor(h);
    adminToken = await api.login(h.fixtures.tenantA, 'admin-a');
    otherToken = await api.login(h.fixtures.tenantB, 'user-b');
  }, 180_000);

  afterAll(async () => {
    await h?.close();
  });

  // ── 종료 게이트 ──────────────────────────────────────────────────────────

  it('미결을 목록으로 미리 보여 준다', async () => {
    const r = await seed('preview', { settled: false });
    const res = await preview(r);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { closable: boolean; blockers: Array<{ kind: string; refId: string; detail: string }> };
    };
    assertMatchesSchema('ClosurePreview', body.data);

    expect(body.data.closable).toBe(false);
    const kinds = body.data.blockers.map((b) => b.kind);
    expect(kinds).toContain('ACTIVE_RUN');
    expect(kinds).toContain('OPEN_TASK');
    // 사람이 왜 막혔는지 읽을 수 있어야 한다.
    for (const blocker of body.data.blockers) expect(blocker.detail.length).toBeGreaterThan(0);
  });

  it('미결이 있으면 목록과 함께 막는다', async () => {
    const r = await seed('blocked', { settled: false });
    const res = await close(r);
    expect(res.status).toBe(412);
    const body = (await res.json()) as {
      error: { code: string };
      meta: { blockers?: Array<{ refId: string }> };
    };
    expect(body.error.code).toBe('SIT-412-010');
    // **빈 412는 사용자가 왜 막혔는지 모른다.**
    expect(body.meta.blockers?.length ?? 0).toBeGreaterThan(0);
  });

  it('사유 없는 처분은 처분이 아니다', async () => {
    const r = await seed('reason', { settled: false });
    const listed = (await (await preview(r)).json()) as {
      data: { blockers: Array<{ refId: string }> };
    };
    const blank = await close(
      r,
      listed.data.blockers.map((b) => ({ refId: b.refId, disposition: 'WAIVED', reason: ' ' })),
    );
    expect(blank.status).toBe(412);

    const ok = await close(
      r,
      listed.data.blockers.map((b) => ({
        refId: b.refId,
        disposition: 'WAIVED',
        reason: '훈련 종료 후 실물 점검 예정',
      })),
    );
    expect(ok.status, await ok.clone().text()).toBe(200);
  });

  it('완료·취소는 이 경로에서 하지 않는다', async () => {
    const r = await seed('disp', { settled: false });
    const listed = (await (await preview(r)).json()) as {
      data: { blockers: Array<{ refId: string }> };
    };
    const res = await close(
      r,
      listed.data.blockers.map((b) => ({
        refId: b.refId,
        disposition: 'COMPLETED',
        reason: '끝냈음',
      })),
    );
    expect(res.status).toBe(412);
  });

  it('정리된 훈련은 처분 없이 닫히고 기준선이 남는다', async () => {
    const r = await seed('clean');
    const res = await close(r);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as {
      data: { status: string; baselineHash: string; closureEventId: string; waivedCount: number };
    };
    assertMatchesSchema('SituationClosed', body.data);
    expect(body.data.status).toBe('CLOSED');
    expect(body.data.waivedCount).toBe(0);
    expect(body.data.baselineHash).toMatch(/^[0-9a-f]{64}$/);

    const event = await withClient(
      h.dbUrl,
      async (c) =>
        (
          await c.query(
            `SELECT event_type, payload_json FROM execution_event WHERE execution_event_id=$1`,
            [body.data.closureEventId],
          )
        ).rows[0],
    );
    expect(event.event_type).toBe('SITUATION_CLOSED');
    expect((event.payload_json as { baselineHash: string }).baselineHash).toBe(
      body.data.baselineHash,
    );
  });

  it('처분한 사유가 종료 사건에 남는다', async () => {
    const r = await seed('waived', { settled: false });
    const listed = (await (await preview(r)).json()) as {
      data: { blockers: Array<{ refId: string }> };
    };
    const res = await close(
      r,
      listed.data.blockers.map((b) => ({
        refId: b.refId,
        disposition: 'WAIVED',
        reason: '통제관 판단으로 종료 후 정리',
      })),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { closureEventId: string; waivedCount: number } };
    expect(body.data.waivedCount).toBeGreaterThan(0);

    const payload = await withClient(
      h.dbUrl,
      async (c) =>
        (
          await c.query(`SELECT payload_json FROM execution_event WHERE execution_event_id=$1`, [
            body.data.closureEventId,
          ])
        ).rows[0].payload_json,
    );
    const waived = (payload as { waived: Array<{ reason: string; kind: string }> }).waived;
    expect(waived.length).toBe(body.data.waivedCount);
    for (const item of waived) {
      expect(item.reason).toBe('통제관 판단으로 종료 후 정리');
      expect(item.kind).not.toBe('UNKNOWN');
    }
  });

  it('두 번 닫지 않는다', async () => {
    const r = await seed('twice');
    expect((await close(r)).status).toBe(200);
    const again = await close(r);
    expect(again.status).toBe(412);
    expect(await errorCode(again)).toBe('SIT-412-010');
  });

  // ── 이 항목의 핵심 함정 ──────────────────────────────────────────────────

  it('닫힌 뒤 새 사실은 못 쓰고 정정은 쓸 수 있다', async () => {
    // 전부 막으면 US-SIT-036 E-02(평가 중 원 이벤트 정정)가 죽고,
    // 아무것도 안 막으면 최종 기준선이 거짓이 된다.
    const r = await seed('frozen');
    expect((await close(r)).status).toBe(200);

    await expect(
      withClient(h.dbUrl, (c) =>
        c.query(
          `INSERT INTO execution_event
             (tenant_id, situation_id, aggregate_type, aggregate_id, event_type,
              actor_id, payload_json, correlation_id, event_hash)
           VALUES ($1,$2,'TASK',$3,'TASK_COMPLETED',$4,'{}'::jsonb,'corr-late',$5)`,
          [h.fixtures.tenantA, r.situationId, r.taskId, h.fixtures.adminA, '9'.repeat(64)],
        ),
      ),
    ).rejects.toThrow(/종료된 상황에는 새 사실을 쓸 수 없다/);

    // 정정은 들어간다.
    const correctionId = await withClient(
      h.dbUrl,
      async (c) =>
        (
          await c.query(
            `INSERT INTO execution_event
             (tenant_id, situation_id, aggregate_type, aggregate_id, event_type,
              actor_id, payload_json, correlation_id, event_hash, corrects_event_id)
           VALUES ($1,$2,'TASK',$3,'EXECUTION_EVENT_CORRECTED',$4,'{}'::jsonb,'corr-fix',$5,$6)
           RETURNING execution_event_id`,
            [
              h.fixtures.tenantA,
              r.situationId,
              r.taskId,
              h.fixtures.adminA,
              '8'.repeat(64),
              r.eventId,
            ],
          )
        ).rows[0].execution_event_id as string,
    );
    expect(correctionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  // ── 평가 ─────────────────────────────────────────────────────────────────

  it('종료된 훈련만 평가할 수 있다', async () => {
    const r = await seed('open-eval');
    const early = await evaluate(r, [
      { criterionCode: 'X', scoreValue: 1, weightValue: 1, evidenceEventIds: [] },
    ]);
    expect(early.status).toBe(412);
    expect(await errorCode(early)).toBe('EVAL-412-001');
  });

  it('사실원장에서 접은 지표를 고정해 담는다', async () => {
    const r = await seed('metrics');
    await close(r);
    const res = await evaluate(r, [
      {
        criterionCode: 'DISPATCH_TIME',
        scoreValue: 90,
        weightValue: 2,
        evidenceEventIds: [r.eventId],
      },
      { criterionCode: 'REPORT_QUALITY', scoreValue: 70, weightValue: 1, evidenceEventIds: [] },
    ]);
    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as {
      data: {
        overallScore: number;
        metrics: { kpi: { total: number; completed: number }; completionRate: number };
        metricsStale: boolean;
      };
    };
    assertMatchesSchema('Evaluation', body.data);

    // 가중 평균: (90*2 + 70*1) / 3
    expect(body.data.overallScore).toBeCloseTo(83.33, 1);
    // 산출기는 CC-290의 것 하나다 — 임무 하나가 완료로 접힌다.
    expect(body.data.metrics.kpi.total).toBe(1);
    expect(body.data.metrics.kpi.completed).toBe(1);
    expect(body.data.metrics.completionRate).toBe(1);
    expect(body.data.metricsStale).toBe(false);
  });

  it('허공을 가리키는 근거는 거절한다', async () => {
    const r = await seed('evidence');
    const other = await seed('evidence-other');
    await close(r);

    const ghost = await evaluate(r, [
      {
        criterionCode: 'X',
        scoreValue: 1,
        weightValue: 1,
        evidenceEventIds: ['00000000-0000-4000-8000-000000000000'],
      },
    ]);
    expect(ghost.status).toBe(422);
    expect(await errorCode(ghost)).toBe('EVAL-422-001');

    // 남의 훈련 이벤트도 안 된다.
    const foreign = await evaluate(r, [
      { criterionCode: 'X', scoreValue: 1, weightValue: 1, evidenceEventIds: [other.eventId] },
    ]);
    expect(foreign.status).toBe(422);
  });

  it('정정이 붙으면 고정한 지표가 낡았다고 말한다 — 다시 계산하지는 않는다', async () => {
    const r = await seed('stale');
    await close(r);
    const evaluationId = await evaluationOf(r);

    const before = (await (
      await api.call('GET', `/api/v1/evaluations/${evaluationId}`, adminToken)
    ).json()) as { data: { metricsStale: boolean; metrics: { kpi: { completed: number } } } };
    expect(before.data.metricsStale).toBe(false);

    // 종료 뒤에도 정정은 들어간다(0045 §5).
    await withClient(h.dbUrl, (c) =>
      c.query(
        `INSERT INTO execution_event
           (tenant_id, situation_id, aggregate_type, aggregate_id, event_type,
            actor_id, payload_json, correlation_id, event_hash, corrects_event_id)
         VALUES ($1,$2,'TASK',$3,'EXECUTION_EVENT_CORRECTED',$4,'{}'::jsonb,'corr-x',$5,$6)`,
        [h.fixtures.tenantA, r.situationId, r.taskId, h.fixtures.adminA, '7'.repeat(64), r.eventId],
      ),
    );

    const after = (await (
      await api.call('GET', `/api/v1/evaluations/${evaluationId}`, adminToken)
    ).json()) as { data: { metricsStale: boolean; metrics: { kpi: { completed: number } } } };
    expect(after.data.metricsStale).toBe(true);
    // **값은 그대로다.** 조회할 때마다 숫자가 달라지면 무엇을 확정한 것인지 모른다.
    expect(after.data.metrics.kpi.completed).toBe(before.data.metrics.kpi.completed);
  });

  it('한 훈련에 평가는 하나다', async () => {
    const r = await seed('single');
    await close(r);
    await evaluationOf(r);
    const second = await evaluate(r, [
      { criterionCode: 'Y', scoreValue: 1, weightValue: 1, evidenceEventIds: [] },
    ]);
    expect(second.status).toBe(422);
  });

  // ── 개선조치 ─────────────────────────────────────────────────────────────

  it('개선조치는 대상을 가리키되 바꾸지 않는다', async () => {
    const r = await seed('improve');
    await close(r);
    const evaluationId = await evaluationOf(r);

    const sopBefore = await withClient(
      h.dbUrl,
      async (c) =>
        (await c.query(`SELECT to_jsonb(s) AS row FROM sop s WHERE sop_id=$1`, [r.sopId])).rows[0]
          .row,
    );

    const res = await api.call(
      'POST',
      `/api/v1/evaluations/${evaluationId}/improvements`,
      adminToken,
      {
        body: {
          actions: [
            {
              actionText: '전파 문안에 대피로를 넣는다.',
              ownerUserId: h.fixtures.adminA,
              dueAt: new Date(Date.now() + 86_400_000).toISOString(),
              targetType: 'SOP',
              targetId: r.sopId,
            },
            { actionText: '알림 채널 이중화 검토', targetType: 'SYSTEM' },
          ],
        },
        idempotencyKey: idem('improve'),
      },
    );
    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as {
      data: { improvements: Array<{ targetType: string | null; status: string }> };
    };
    expect(body.data.improvements).toHaveLength(2);
    expect(body.data.improvements.every((a) => a.status === 'OPEN')).toBe(true);

    // **대상은 그대로다.** 자동변경 금지(US-SIT-036 6단계).
    const sopAfter = await withClient(
      h.dbUrl,
      async (c) =>
        (await c.query(`SELECT to_jsonb(s) AS row FROM sop s WHERE sop_id=$1`, [r.sopId])).rows[0]
          .row,
    );
    expect(sopAfter).toEqual(sopBefore);
  });

  it('없는 대상을 가리키는 환류는 거절한다', async () => {
    const r = await seed('ghost-target');
    await close(r);
    const evaluationId = await evaluationOf(r);
    const res = await api.call(
      'POST',
      `/api/v1/evaluations/${evaluationId}/improvements`,
      adminToken,
      {
        body: {
          actions: [
            {
              actionText: '어딘가를 고친다',
              targetType: 'SOP',
              targetId: '00000000-0000-4000-8000-000000000000',
            },
          ],
        },
        idempotencyKey: idem('ghost-target'),
      },
    );
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('EVAL-422-002');
  });

  // ── 확정과 보고서 ────────────────────────────────────────────────────────

  it('확정된 평가는 얼어붙는다 — DB도 막는다', async () => {
    const r = await seed('confirm');
    await close(r);
    const evaluationId = await evaluationOf(r);

    const confirmed = await api.call(
      'POST',
      `/api/v1/evaluations/${evaluationId}/confirm`,
      adminToken,
      { body: {}, idempotencyKey: idem('confirm') },
    );
    expect(confirmed.status, await confirmed.clone().text()).toBe(200);
    const body = (await confirmed.json()) as {
      data: { status: string; confirmedBy: string; confirmedAt: string };
    };
    expect(body.data.status).toBe('CONFIRMED');
    expect(body.data.confirmedBy).toBe(h.fixtures.adminA);

    // 서비스가 막는다.
    const more = await api.call(
      'POST',
      `/api/v1/evaluations/${evaluationId}/improvements`,
      adminToken,
      { body: { actions: [{ actionText: '뒤늦은 조치' }] }, idempotencyKey: idem('late') },
    );
    expect(more.status).toBe(409);
    expect(await errorCode(more)).toBe('EVAL-409-001');

    // DB도 막는다 — 서비스 가드만으로는 다음 항목이 새 경로를 열 때 뚫린다.
    await expect(
      withClient(h.dbUrl, (c) =>
        c.query(`UPDATE evaluation SET summary='몰래' WHERE evaluation_id=$1`, [evaluationId]),
      ),
    ).rejects.toThrow(/확정된 평가는 바꿀 수 없다/);
    await expect(
      withClient(h.dbUrl, (c) =>
        c.query(
          `INSERT INTO evaluation_score (evaluation_id, criterion_code, score_value, weight_value)
           VALUES ($1,'SNEAK',1,1)`,
          [evaluationId],
        ),
      ),
    ).rejects.toThrow(/확정된 평가의 점수·개선조치는 바꿀 수 없다/);
  });

  it('보고서가 빈 자리를 말로 채운다', async () => {
    const r = await seed('report');
    await close(r);
    const evaluationId = await evaluationOf(r);
    await api.call('POST', `/api/v1/evaluations/${evaluationId}/improvements`, adminToken, {
      body: { actions: [{ actionText: '문안 보완', targetType: 'SYSTEM' }] },
      idempotencyKey: idem('report-improve'),
    });

    const res = await api.call('GET', `/api/v1/evaluations/${evaluationId}/report`, adminToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        satisfaction: { status: string; reason: string; responseCount: number };
        criteriaWithoutEvidence: string[];
        improvementsByTarget: Array<{ targetType: string; count: number }>;
      };
    };
    assertMatchesSchema('EvaluationReport', body.data);

    // **부재를 1급 값으로.** 빈 배열은 "설문했는데 0건"과 구분되지 않는다.
    expect(body.data.satisfaction.status).toBe('NOT_COLLECTED');
    expect(body.data.satisfaction.reason.length).toBeGreaterThan(10);
    expect(body.data.satisfaction.responseCount).toBe(0);
    expect(body.data.improvementsByTarget).toEqual([{ targetType: 'SYSTEM', count: 1 }]);
  });

  it('근거 없이 매긴 지표를 보고서가 센다', async () => {
    const r = await seed('no-evidence');
    await close(r);
    const created = await evaluate(r, [
      {
        criterionCode: 'DISPATCH_TIME',
        scoreValue: 80,
        weightValue: 1,
        evidenceEventIds: [r.eventId],
      },
      { criterionCode: 'QUALITATIVE', scoreValue: 60, weightValue: 1, evidenceEventIds: [] },
    ]);
    const evaluationId = ((await created.json()) as { data: { evaluationId: string } }).data
      .evaluationId;

    const report = (await (
      await api.call('GET', `/api/v1/evaluations/${evaluationId}/report`, adminToken)
    ).json()) as { data: { criteriaWithoutEvidence: string[] } };
    // 막지 않되 말한다 — 정성평가는 이벤트로 뒷받침되지 않을 수 있다.
    expect(report.data.criteriaWithoutEvidence).toEqual(['QUALITATIVE']);
  });

  it('없는 형식을 약속하지 않는다', async () => {
    const r = await seed('format');
    await close(r);
    const evaluationId = await evaluationOf(r);
    const res = await api.call(
      'GET',
      `/api/v1/evaluations/${evaluationId}/report?format=HWPX`,
      adminToken,
    );
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('EVAL-422-003');
  });

  // ── 경계 ─────────────────────────────────────────────────────────────────

  it('큐에 남은 전파는 사유로도 넘길 수 없다', async () => {
    // 닫으면 릴레이가 그것을 보내려 할 때 사실원장이 거부하고 지시가 죽는다.
    // 사유를 적는다고 살아나지 않으므로 먼저 정리해야 한다.
    const r = await seed('pending-dispatch');
    await withClient(h.dbUrl, async (c) => {
      const dispatchId = (
        await c.query(
          `INSERT INTO dispatch
             (task_id, situation_id, message_type, message_body, status, created_by)
           VALUES ($1,$2,'TASK','대피 방송','PENDING',$3) RETURNING dispatch_id`,
          [r.taskId, r.situationId, h.fixtures.adminA],
        )
      ).rows[0].dispatch_id as string;
      const recipientId = (
        await c.query(
          `INSERT INTO dispatch_recipient (dispatch_id, user_id, channel, delivery_status)
           VALUES ($1,$2,'SMS','PENDING') RETURNING recipient_id`,
          [dispatchId, h.fixtures.fieldA],
        )
      ).rows[0].recipient_id as string;
      await c.query(
        `INSERT INTO outbox_message
           (tenant_id, aggregate_type, aggregate_id, event_type, payload_json, channel,
            status, attempt_count, idempotency_key, dispatch_recipient_id)
         VALUES ($1,'DISPATCH',$2,'TASK_DISPATCHED','{}'::jsonb,'SMS','PENDING',0,$3,$4)`,
        [h.fixtures.tenantA, r.taskId, `idem-pd-${r.taskId}`, recipientId],
      );
    });

    const listed = (await (await preview(r)).json()) as {
      data: { blockers: Array<{ kind: string; refId: string; waivable: boolean }> };
    };
    const pending = listed.data.blockers.filter((b) => b.kind === 'PENDING_DISPATCH');
    expect(pending).toHaveLength(1);
    expect(pending[0].waivable).toBe(false);

    // 사유를 적어도 막힌다.
    const res = await close(
      r,
      listed.data.blockers.map((b) => ({
        refId: b.refId,
        disposition: 'WAIVED',
        reason: '그냥 닫겠다',
      })),
    );
    expect(res.status).toBe(412);
    expect(await errorCode(res)).toBe('SIT-412-010');
  });

  it('시작하지 않은 훈련은 닫지 않는다', async () => {
    // 사실 하나 없는 빈 훈련을 닫으면 빈 기준선이 영구 동결된다.
    const situationId = await withClient(
      h.dbUrl,
      async (c) =>
        (
          await c.query(
            `INSERT INTO situation (tenant_id, mode, title, hazard_type, status, created_by)
             VALUES ($1,'EXERCISE','시작 전','FLOOD','DRAFT',$2) RETURNING situation_id`,
            [h.fixtures.tenantA, h.fixtures.adminA],
          )
        ).rows[0].situation_id as string,
    );
    const res = await api.call('POST', `/api/v1/situations/${situationId}/close`, adminToken, {
      body: { resultSummary: null, dispositions: [] },
      idempotencyKey: idem('close-draft'),
    });
    expect(res.status).toBe(412);
    expect(await errorCode(res)).toBe('SIT-412-010');
  });

  it('종료 뒤 임무 전이는 읽을 수 있는 412로 막힌다 — 500이 아니다', async () => {
    // 트리거의 42501을 그대로 두면 "서버 오류"가 되어 사용자는 왜 막혔는지 모른다.
    const r = await seed('closed-write', { settled: false });
    const listed = (await (await preview(r)).json()) as {
      data: { blockers: Array<{ refId: string }> };
    };
    await close(
      r,
      listed.data.blockers.map((b) => ({
        refId: b.refId,
        disposition: 'WAIVED',
        reason: '종료 후 정리 예정',
      })),
    );

    // **담당자 토큰으로** 부른다 — 권한으로 먼저 막히면 이 시험은 트리거를
    // 한 번도 태우지 않고 통과한다(권한 403과 종료 412는 다른 결함 계열이다).
    const field = await api.login(h.fixtures.tenantA, 'field-a');
    const res = await api.call('POST', `/api/v1/tasks/${r.taskId}/acknowledge`, field, {
      body: {},
      idempotencyKey: idem('late-ack'),
    });
    expect(res.status, await res.clone().text()).toBe(412);
    // 사용자가 읽을 수 있는 문장이어야 한다 — "서버 오류"가 아니다.
    const body = (await res.json()) as {
      error: { code: string; message: string; userAction?: string };
    };
    expect(body.error.code).toBe('SIT-412-011');
    expect(body.error.message).toContain('종료');
    expect(body.error.userAction ?? '').toContain('정정');
  });

  it('지연 임무를 실제로 센다 — 기한은 임무 행에서 온다', async () => {
    // **기한은 이벤트가 모른다.** 넘기지 않으면 overdue가 구조적으로 0이 되어
    // 평가서에 "지연 0%"라는 거짓이 박힌다. 끝나지 않은 채 기한을 넘긴 임무로
    // 그것을 태운다 — 완료된 임무는 정의상 지연이 아니다(CC-290 규칙).
    const r = await seed('overdue', { settled: false });
    await withClient(h.dbUrl, (c) =>
      c.query(`UPDATE task SET due_at = now() - interval '1 day' WHERE task_id=$1`, [r.taskId]),
    );
    const listed = (await (await preview(r)).json()) as {
      data: { blockers: Array<{ refId: string }> };
    };
    await close(
      r,
      listed.data.blockers.map((b) => ({
        refId: b.refId,
        disposition: 'WAIVED',
        reason: '기한을 넘긴 채 종료 — 사후 점검',
      })),
    );
    const res = await evaluate(r, [
      { criterionCode: 'A', scoreValue: 50, weightValue: 1, evidenceEventIds: [r.eventId] },
    ]);
    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as {
      data: { metrics: { kpi: { total: number; overdue: number }; overdueRate: number } };
    };
    expect(body.data.metrics.kpi.total).toBe(1);
    expect(body.data.metrics.kpi.overdue).toBe(1);
    expect(body.data.metrics.overdueRate).toBe(1);
  });

  it('권한 없는 사용자는 어느 연산도 하지 못한다', async () => {
    const r = await seed('perm');
    await close(r);
    const evaluationId = await evaluationOf(r);
    const reader = await api.login(h.fixtures.tenantA, 'reader-a');

    expect((await preview(r, reader)).status).toBe(403);
    expect((await api.call('GET', `/api/v1/evaluations/${evaluationId}`, reader)).status).toBe(403);
    const improve = await api.call(
      'POST',
      `/api/v1/evaluations/${evaluationId}/improvements`,
      reader,
      { body: { actions: [{ actionText: 'x' }] }, idempotencyKey: idem('perm-improve') },
    );
    expect(improve.status).toBe(403);
  });

  it('같은 멱등 키 재요청은 같은 평가를 돌려준다', async () => {
    const r = await seed('idem');
    await close(r);
    const key = idem('eval-once');
    const body = {
      summary: '한 번만',
      scores: [
        { criterionCode: 'A', scoreValue: 50, weightValue: 1, evidenceEventIds: [r.eventId] },
      ],
    };
    const call = async (): Promise<string> => {
      const res = await api.call(
        'POST',
        `/api/v1/situations/${r.situationId}/evaluations`,
        adminToken,
        { body, idempotencyKey: key },
      );
      expect(res.status).toBe(201);
      return ((await res.json()) as { data: { evaluationId: string } }).data.evaluationId;
    };
    const first = await call();
    expect(await call()).toBe(first);

    const count = await withClient(h.dbUrl, async (c) =>
      Number(
        (
          await c.query(`SELECT count(*) AS n FROM evaluation WHERE situation_id=$1`, [
            r.situationId,
          ])
        ).rows[0].n,
      ),
    );
    expect(count).toBe(1);
  });

  it('연산마다 감사 기록을 남긴다', async () => {
    const r = await seed('audit');
    await close(r);
    const evaluationId = await evaluationOf(r);
    await api.call('POST', `/api/v1/evaluations/${evaluationId}/improvements`, adminToken, {
      body: { actions: [{ actionText: '조치', targetType: 'SYSTEM' }] },
      idempotencyKey: idem('audit-improve'),
    });
    await api.call('POST', `/api/v1/evaluations/${evaluationId}/confirm`, adminToken, {
      body: {},
      idempotencyKey: idem('audit-confirm'),
    });

    const actions = await withClient(h.dbUrl, async (c) =>
      (
        await c.query(
          `SELECT action FROM audit_log
            WHERE resource_id IN ($1, $2) ORDER BY occurred_at, audit_id`,
          [r.situationId, evaluationId],
        )
      ).rows.map((row) => row.action as string),
    );
    expect(actions).toEqual([
      'SITUATION_CLOSED',
      'EVALUATION_CREATED',
      'IMPROVEMENT_ADDED',
      'EVALUATION_CONFIRMED',
    ]);
  });

  it('다른 기관의 훈련과 평가는 보이지 않는다', async () => {
    const r = await seed('tenant');
    await close(r);
    const evaluationId = await evaluationOf(r);

    expect((await preview(r, otherToken)).status).toBe(404);
    const foreign = await api.call('GET', `/api/v1/evaluations/${evaluationId}`, otherToken);
    expect(foreign.status).toBe(404);
    expect(await errorCode(foreign)).toBe('EVAL-404-001');
  });
});
