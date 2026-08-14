import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_URL, apiFor, idem, startHarness, withClient, type Harness } from './harness';

/**
 * 상황 → 근거 → SOP 슬라이스 E2E (CC-240, UNE-SOP-001/002).
 *
 * 워커 e2e가 증명한 것은 "잡을 집으면 그래프가 생긴다"이고, 여기서 증명할 것은
 * **HTTP 경계**다: 누가 부를 수 있는가, 언제 거절하는가, 같은 키로 두 번 부르면
 * 어떻게 되는가, 그리고 사용자가 SSE로 무엇을 보는가.
 *
 * 상황·근거는 SQL로 심는다. UNE-SIT/KNOW 경로는 CC-200~230의 e2e가 이미
 * 증명했고, 그것을 여기서 다시 태우면 실패했을 때 "무엇이 깨졌나"가 흐려진다.
 */

interface Seed {
  situationId: string;
  snapshotId: string;
  evidenceSetId: string;
}

describe.skipIf(!ADMIN_URL)('SOP 생성 슬라이스 (CC-240)', () => {
  let h: Harness;
  let api: ReturnType<typeof apiFor>;
  let adminToken: string;
  let readerToken: string;
  let otherToken: string;
  /** SOP 권한만 가진 사용자 — 잡 유형 경계를 시험한다. */
  let sopOnlyToken: string;

  const seed = async (code: string, tenantId: string, userId: string): Promise<Seed> =>
    withClient(h.dbUrl, async (c) => {
      const situationId = (
        await c.query(
          `INSERT INTO situation (tenant_id, mode, title, hazard_type, status, created_by)
           VALUES ($1,'LIVE',$2,'FLOOD','CONTEXT_CONFIRMED',$3) RETURNING situation_id`,
          [tenantId, `상황 ${code}`, userId],
        )
      ).rows[0].situation_id as string;
      const snapshotId = (
        await c.query(
          `INSERT INTO situation_snapshot
             (situation_id, version_no, facts_json, content_hash, effective_at, confirmed_by)
           VALUES ($1, 1, '[{"factType":"DAMAGE","value":"침수"}]'::jsonb, $2, now(), $3)
           RETURNING snapshot_id`,
          [situationId, createHash('sha256').update(code).digest('hex'), userId],
        )
      ).rows[0].snapshot_id as string;
      await c.query(`UPDATE situation SET current_snapshot_id = $2 WHERE situation_id = $1`, [
        situationId,
        snapshotId,
      ]);

      const sha = createHash('sha256').update(`${code}-f`).digest('hex');
      const fileId = (
        await c.query(
          `INSERT INTO file_object
             (tenant_id, original_name, mime_type, size_bytes, sha256, storage_key,
              scan_status, upload_state, verified_at, purpose, created_by)
           VALUES ($1,'지침.pdf','application/pdf',3,$2,$3,'CLEAN','VERIFIED',now(), 'KNOWLEDGE_DOCUMENT', $4)
           RETURNING file_id`,
          [tenantId, sha, `tenants/${tenantId}/k/${code}`, userId],
        )
      ).rows[0].file_id as string;
      const documentId = (
        await c.query(
          `INSERT INTO knowledge_document
             (tenant_id, situation_id, file_id, document_type, status, retention_scope,
              source_sha256, metadata_json, created_by, provider_document_id, uni_status,
              uni_observed_at)
           VALUES ($1,$2,$3,'MANUAL','REGISTERED','THIS_INCIDENT',$4,'{}'::jsonb,$5,$6,'READY',now())
           RETURNING knowledge_document_id`,
          [tenantId, situationId, fileId, sha, userId, `uni-${code}`],
        )
      ).rows[0].knowledge_document_id as string;

      const evidenceSetId = (
        await c.query(
          `INSERT INTO evidence_set
             (situation_id, snapshot_id, query_text, filters_json, top_k, status,
              content_hash, created_by)
           VALUES ($1,$2,'대피 절차','{}'::jsonb,5,'DRAFT',$3,$4)
           RETURNING evidence_set_id`,
          [situationId, snapshotId, createHash('sha256').update(`${code}-e`).digest('hex'), userId],
        )
      ).rows[0].evidence_set_id as string;
      await c.query(
        `INSERT INTO evidence_item
           (evidence_set_id, knowledge_document_id, provider_chunk_id, rank_no, score,
            quote_text, source_locator_json, citation_key)
         VALUES ($1,$2,'c1',1,0.9,'대피 방송','{}'::jsonb,'E1')`,
        [evidenceSetId, documentId],
      );
      await c.query(
        `UPDATE evidence_set SET status = 'FROZEN', frozen_at = now(), frozen_by = $2
          WHERE evidence_set_id = $1`,
        [evidenceSetId, userId],
      );
      return { situationId, snapshotId, evidenceSetId };
    });

  const body = (s: Seed) => ({
    snapshotId: s.snapshotId,
    evidenceSetId: s.evidenceSetId,
    schemaVersion: '1.0',
  });

  const request = async (s: Seed, token: string, key = idem('sop')): Promise<Response> =>
    api.call('POST', `/api/v1/situations/${s.situationId}/sop-generation-jobs`, token, {
      body: body(s),
      idempotencyKey: key,
    });

  /**
   * 이 잡이 종결될 때까지 러너를 돌린다.
   *
   * 총계(`summary.completed`)로 단언하면 안 된다 — 러너는 디스패치 스코프에서
   * **모든 테넌트의 큐**를 집으므로 앞선 테스트가 남긴 잡까지 함께 센다.
   * 배치 크기 때문에 한 번에 다 집지도 않는다(QA F3에서 총계가 4로 나왔다).
   */
  const settle = async (jobId: string): Promise<string> => {
    for (let i = 0; i < 10; i += 1) {
      await h.sop.runOnce();
      const status = await jobStatus(jobId);
      if (status !== 'QUEUED' && status !== 'RUNNING') return status;
    }
    throw new Error(`잡이 종결되지 않았다: ${jobId}`);
  };

  const jobStatus = async (jobId: string): Promise<string> =>
    withClient(
      h.dbUrl,
      async (c) =>
        (await c.query(`SELECT status FROM generation_job WHERE job_id = $1`, [jobId])).rows[0]
          .status as string,
    );

  const errorCode = async (res: Response): Promise<string> => {
    const parsed = (await res.json()) as { error?: { code?: string } };
    return parsed.error?.code ?? 'NO_CODE';
  };

  beforeAll(async () => {
    h = await startHarness('cc240_e2e');
    api = apiFor(h);
    adminToken = await api.login(h.fixtures.tenantA, 'admin-a');
    readerToken = await api.login(h.fixtures.tenantA, 'reader-a');
    otherToken = await api.login(h.fixtures.tenantB, 'user-b');
    sopOnlyToken = await api.login(h.fixtures.tenantA, 'sop-only-a');
  }, 180_000);

  afterAll(async () => {
    if (h) await h.close();
  });

  it('접수 → 워커 처리 → SSE로 그래프가 도착한다', async () => {
    const s = await seed('ok', h.fixtures.tenantA, h.fixtures.adminA);
    const created = await api.json<{ data: { jobId: string; status: string } }>(
      await request(s, adminToken),
      201,
    );
    // 201이지만 "만들어진 것"은 Job이지 SOP가 아니다.
    expect(created.data.status).toBe('QUEUED');

    expect(await settle(created.data.jobId)).toBe('COMPLETED');

    const stream = await api.call(
      'GET',
      `/api/v1/sop-generation-jobs/${created.data.jobId}/events`,
      adminToken,
    );
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    const frames = await stream.text();

    // 사용자가 보는 것은 UNE 어휘다.
    expect(frames).toContain('event: job.queued');
    expect(frames).toContain('event: sop.node');
    expect(frames).toContain('event: job.completed');
    // UNI 원문 이벤트도, 내부 추적 이벤트도 나가지 않는다.
    expect(frames).not.toContain('__compn__');
    expect(frames).not.toContain('provider.responded');
    expect(frames).not.toContain('provider.requested');

    const completed = frames
      .split('\n\n')
      .find((f) => f.includes('event: job.completed')) as string;
    const payload = JSON.parse(completed.slice(completed.indexOf('data: ') + 6)) as {
      payload: { sopVersionNo: number; nodeCount: number; graphViolations: string[] };
    };
    // nodeCount 4 = UNI가 보낸 노드 3 + **매달린 간선을 보고 UNE가 세운 END 1**
    // (CC-410). 실 UNI는 마지막 노드가 가리키는 종료 노드를 보내지 않는다 —
    // 세우지 않으면 NO_END·DANGLING_EDGE로 승인이 막힌다.
    expect(payload.payload).toMatchObject({ sopVersionNo: 1, nodeCount: 4, graphViolations: [] });
  }, 120_000);

  it('같은 멱등키로 두 번 부르면 같은 Job이다', async () => {
    const s = await seed('idem', h.fixtures.tenantA, h.fixtures.adminA);
    const key = idem('sop-same');
    const first = await api.json<{ data: { jobId: string } }>(
      await request(s, adminToken, key),
      201,
    );
    const second = await api.json<{ data: { jobId: string } }>(
      await request(s, adminToken, key),
      201,
    );
    expect(second.data.jobId).toBe(first.data.jobId);

    const jobs = await withClient(
      h.dbUrl,
      async (c) =>
        (
          await c.query(
            `SELECT count(*)::int n FROM generation_job WHERE aggregate_id = $1 AND job_type = 'SOP'`,
            [s.situationId],
          )
        ).rows[0].n,
    );
    expect(jobs).toBe(1);
  }, 120_000);

  it('멱등키가 없으면 접수하지 않는다', async () => {
    const s = await seed('nokey', h.fixtures.tenantA, h.fixtures.adminA);
    const res = await api.call(
      'POST',
      `/api/v1/situations/${s.situationId}/sop-generation-jobs`,
      adminToken,
      { body: body(s) },
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('COM-0400');
  }, 120_000);

  it('진행 중인 Job이 있으면 두 번째 요청을 막는다', async () => {
    // 두 개가 동시에 끝나면 같은 근거에서 나온 버전이 둘 생긴다.
    const s = await seed('active', h.fixtures.tenantA, h.fixtures.adminA);
    await api.json(await request(s, adminToken), 201);
    const second = await request(s, adminToken);
    expect(second.status).toBe(409);
    expect(await errorCode(second)).toBe('SOP-409-001');
  }, 120_000);

  it('낡은 판으로는 만들지 않는다', async () => {
    const s = await seed('stale', h.fixtures.tenantA, h.fixtures.adminA);
    const older = await withClient(
      h.dbUrl,
      async (c) =>
        (
          await c.query(
            `INSERT INTO situation_snapshot
               (situation_id, version_no, facts_json, content_hash, effective_at, confirmed_by)
             VALUES ($1, 2, '[{"factType":"DAMAGE","value":"옛판"}]'::jsonb, $2, now(), $3)
             RETURNING snapshot_id`,
            [
              s.situationId,
              createHash('sha256').update('stale-old').digest('hex'),
              h.fixtures.adminA,
            ],
          )
        ).rows[0].snapshot_id as string,
    );
    const res = await api.call(
      'POST',
      `/api/v1/situations/${s.situationId}/sop-generation-jobs`,
      adminToken,
      { body: { ...body(s), snapshotId: older }, idempotencyKey: idem('sop-stale') },
    );
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('SOP-409-002');
  }, 120_000);

  it('동결되지 않은 근거집합을 거절한다', async () => {
    const s = await seed('draft-ev', h.fixtures.tenantA, h.fixtures.adminA);
    const draft = await withClient(
      h.dbUrl,
      async (c) =>
        (
          await c.query(
            `INSERT INTO evidence_set
               (situation_id, snapshot_id, query_text, filters_json, top_k, status,
                content_hash, created_by)
             VALUES ($1,$2,'미고정','{}'::jsonb,5,'DRAFT',$3,$4)
             RETURNING evidence_set_id`,
            [
              s.situationId,
              s.snapshotId,
              createHash('sha256').update('draft-ev-2').digest('hex'),
              h.fixtures.adminA,
            ],
          )
        ).rows[0].evidence_set_id as string,
    );
    const res = await api.call(
      'POST',
      `/api/v1/situations/${s.situationId}/sop-generation-jobs`,
      adminToken,
      { body: { ...body(s), evidenceSetId: draft }, idempotencyKey: idem('sop-draft') },
    );
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('UNI-422-003');
  }, 120_000);

  it('확정 전 상황에서는 만들 수 없다', async () => {
    const s = await seed('early', h.fixtures.tenantA, h.fixtures.adminA);
    await withClient(h.dbUrl, (c) =>
      c.query(`UPDATE situation SET status = 'REGISTERED' WHERE situation_id = $1`, [
        s.situationId,
      ]),
    );
    const res = await request(s, adminToken);
    expect(res.status).toBe(412);
    expect(await errorCode(res)).toBe('SOP-412-001');
  }, 120_000);

  it('SOP_GENERATE 권한이 없으면 막는다', async () => {
    const s = await seed('perm', h.fixtures.tenantA, h.fixtures.adminA);
    const res = await request(s, readerToken);
    expect(res.status).toBe(403);
  }, 120_000);

  it('다른 기관의 상황은 찾을 수 없다 (존재 여부를 흘리지 않는다)', async () => {
    const s = await seed('tenant', h.fixtures.tenantA, h.fixtures.adminA);
    const res = await request(s, otherToken);
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe('SOP-404-001');
  }, 120_000);

  it('다른 기관은 남의 Job 스트림을 열 수 없다', async () => {
    const s = await seed('sse-tenant', h.fixtures.tenantA, h.fixtures.adminA);
    const created = await api.json<{ data: { jobId: string } }>(await request(s, adminToken), 201);
    const res = await api.call(
      'GET',
      `/api/v1/sop-generation-jobs/${created.data.jobId}/events`,
      otherToken,
    );
    // 스트림을 200으로 열어놓고 안에서 오류를 흘리면 이미 늦다 — 헤더 전에 막는다.
    expect(res.status).toBe(404);
    await res.text();
  }, 120_000);

  it('실패한 생성도 사용자에게 사유가 도착한다', async () => {
    const s = await seed('.sop-truncated. 상황', h.fixtures.tenantA, h.fixtures.adminA);
    const created = await api.json<{ data: { jobId: string } }>(await request(s, adminToken), 201);
    expect(await settle(created.data.jobId)).toBe('FAILED');

    const frames = await (
      await api.call('GET', `/api/v1/sop-generation-jobs/${created.data.jobId}/events`, adminToken)
    ).text();
    expect(frames).toContain('event: job.failed');
    expect(frames).toContain('UNI-503-003');
    // 부분 노드 수가 함께 온다 — 폐기 여부는 사용자 결정이다(설계 08 §1.11).
    expect(frames).toContain('partialNodeCount');
    // 실패 사유에도 provider 원문은 실리지 않는다.
    expect(frames).not.toContain('__compn__');
  }, 120_000);

  it('Last-Event-ID로 이어받으면 이미 본 프레임은 오지 않는다', async () => {
    const s = await seed('resume', h.fixtures.tenantA, h.fixtures.adminA);
    const created = await api.json<{ data: { jobId: string } }>(await request(s, adminToken), 201);
    expect(await settle(created.data.jobId)).toBe('COMPLETED');

    const all = await (
      await api.call('GET', `/api/v1/sop-generation-jobs/${created.data.jobId}/events`, adminToken)
    ).text();
    const ids = [...all.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    const cursor = ids[Math.floor(ids.length / 2)];

    const resumed = await fetch(
      `${h.base}/api/v1/sop-generation-jobs/${created.data.jobId}/events`,
      { headers: { authorization: `Bearer ${adminToken}`, 'last-event-id': String(cursor) } },
    );
    const tail = await resumed.text();
    const tailIds = [...tail.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    expect(Math.min(...tailIds)).toBeGreaterThan(cursor);
    expect(tail).toContain('event: job.completed');
  }, 120_000);

  describe('취소 (UNE-SOP-017)', () => {
    it('QUEUED 잡을 취소할 수 있다', async () => {
      // 이 경로가 없으면 SOP-409-001의 "취소하십시오" 안내가 막다른 길이다.
      // 처음에는 UNE-PLAN-012로 취소가 되는 줄 알았는데, 그쪽은 SOP 잡의
      // aggregate_id를 planId로 오인해 PLAN-4003으로 롤백됐다(실측).
      const s = await seed('cancel-q', h.fixtures.tenantA, h.fixtures.adminA);
      const created = await api.json<{ data: { jobId: string } }>(
        await request(s, adminToken),
        201,
      );
      const res = await api.call(
        'POST',
        `/api/v1/sop-generation-jobs/${created.data.jobId}/cancel`,
        adminToken,
        { body: { reason: '잘못 눌렀다' }, idempotencyKey: idem('cancel') },
      );
      expect(res.status).toBe(202);
      expect(await jobStatus(created.data.jobId)).toBe('CANCELLED');

      // 취소한 잡은 워커가 집지 않고, 상황은 다시 생성할 수 있다.
      await h.sop.runOnce();
      expect(await jobStatus(created.data.jobId)).toBe('CANCELLED');
      const again = await request(s, adminToken);
      expect(again.status).toBe(201);
    }, 120_000);

    it('취소 요청은 감사와 이벤트에 남는다', async () => {
      const s = await seed('cancel-audit', h.fixtures.tenantA, h.fixtures.adminA);
      const created = await api.json<{ data: { jobId: string } }>(
        await request(s, adminToken),
        201,
      );
      await api.call(
        'POST',
        `/api/v1/sop-generation-jobs/${created.data.jobId}/cancel`,
        adminToken,
        { body: {}, idempotencyKey: idem('cancel') },
      );
      const rows = await withClient(h.dbUrl, async (c) => ({
        events: (
          await c.query(`SELECT event_type FROM job_event WHERE job_id = $1 ORDER BY sequence_no`, [
            created.data.jobId,
          ])
        ).rows.map((r) => r.event_type as string),
        audits: (
          await c.query(
            `SELECT action FROM audit_log WHERE action LIKE 'SOP%' ORDER BY occurred_at`,
          )
        ).rows.map((r) => r.action as string),
      }));
      expect(rows.events).toContain('job.cancelled');
      expect(rows.audits).toContain('SOP_JOB_CANCELLED');
    }, 120_000);

    it('SOP_GENERATE가 없으면 취소할 수 없다', async () => {
      const s = await seed('cancel-perm', h.fixtures.tenantA, h.fixtures.adminA);
      const created = await api.json<{ data: { jobId: string } }>(
        await request(s, adminToken),
        201,
      );
      const res = await api.call(
        'POST',
        `/api/v1/sop-generation-jobs/${created.data.jobId}/cancel`,
        readerToken,
        { body: {}, idempotencyKey: idem('cancel') },
      );
      expect(res.status).toBe(403);
    }, 120_000);
  });

  describe('도메인 경계 — 잡 유형이 곧 권한 경계다', () => {
    it('SOP 권한만 가진 사용자가 계획서 잡 스트림을 열 수 없다', async () => {
      // 두 엔드포인트가 같은 `generation_job`을 본다. 유형을 검사하지 않으면
      // SOP_READ로 계획서 본문(content.block)을 읽게 된다.
      const planJobId = await withClient(
        h.dbUrl,
        async (c) =>
          (
            await c.query(
              `INSERT INTO generation_job
                 (tenant_id, job_type, aggregate_type, aggregate_id, provider_code, request_json,
                  status, progress_pct, idempotency_key, correlation_id)
               VALUES ($1,'TOC','PLAN',gen_random_uuid(),'T3Q','{}'::jsonb,'QUEUED',0,$2,'corr-x')
               RETURNING job_id`,
              [h.fixtures.tenantA, `idem-plan-${Math.abs(Date.now())}`],
            )
          ).rows[0].job_id as string,
      );

      const res = await api.call(
        'GET',
        `/api/v1/sop-generation-jobs/${planJobId}/events`,
        sopOnlyToken,
      );
      expect(res.status).toBe(404);
      expect(await errorCode(res)).toBe('JOB-404-001');
    }, 120_000);

    it('계획서 권한만 가진 사용자가 SOP 잡을 조회하거나 끌 수 없다', async () => {
      const s = await seed('cross', h.fixtures.tenantA, h.fixtures.adminA);
      const created = await api.json<{ data: { jobId: string } }>(
        await request(s, adminToken),
        201,
      );

      // 권한이 있는 사용자로 시험한다 — 403이면 유형 가드가 아니라 권한이
      // 막은 것이라 아무것도 증명하지 못한다. adminA는 PLAN_READ를 가졌다.
      const read = await api.call('GET', `/api/v1/plan-jobs/${created.data.jobId}`, adminToken);
      expect(read.status).toBe(404);
      expect(await errorCode(read)).toBe('JOB-404-001');

      const cancel = await api.call(
        'POST',
        `/api/v1/plan-jobs/${created.data.jobId}/cancel`,
        adminToken,
        { body: {}, idempotencyKey: idem('x-cancel') },
      );
      expect(cancel.status).toBe(404);
      // 잡은 그대로다 — 남의 도메인 잡을 끄지 못한다.
      expect(await jobStatus(created.data.jobId)).toBe('QUEUED');
    }, 120_000);
  });
});
