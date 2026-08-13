import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_URL,
  TEMPLATE_DIR,
  apiFor,
  idem,
  startHarness,
  withClient,
  type Harness,
} from './harness';

/**
 * 상황–SOP–일지 **수직 슬라이스** E2E (CC-320).
 *
 * 앞선 항목마다 슬라이스 e2e가 있다. 그것들이 증명한 것은 **한 구간이 선다**는
 * 것이고, 저마다 앞 구간을 SQL로 심어 출발점을 만들었다. 그래서 아직 아무도
 * 말하지 못한 것이 하나 있다 — **구간과 구간 사이가 이어지는가.**
 *
 * 이 파일은 훈련 하나를 처음부터 끝까지 **API와 워커로만** 지난다. 도메인 행을
 * SQL로 심지 않는다(테넌트·사용자 고정만 하네스가 만든다). SQL은 단언할 때만
 * 쓴다. 그래야 "앞 구간이 실제로 낸 값을 뒷 구간이 받는가"를 물을 수 있다.
 *
 * 한 줄로 꿴다.
 *
 *   상황 등록(CC-200) → 사실 수집·충돌 해소(CC-200/210) → 판 확정(CC-210)
 *   → 지식문서(CC-220) → 근거 검색·동결(CC-230) → SOP 생성(CC-240)
 *   → 캔버스·검증·승인(CC-250) → 실행·임무(CC-260) → 전파(CC-270)
 *   → 현장 수행·에스컬레이션(CC-280) → 실행 로그·대시보드(CC-290)
 *   → 일지 투영·승인(CC-300) → 종료·평가(CC-310)
 *
 * 수용 기준 넷이 어디에 있는지.
 *
 *   end-to-end exercise flow  — (1)~(13) 전체가 한 시나리오다.
 *   multiple tasks            — (6) ACTION 셋에서 임무 셋이 나오고 첫 임무만
 *                                열린다. (8) 완료·승인이 다음을 연다.
 *   failure/retry/escalation  — (14) 실사건 전파가 실패해도 재시도하고 큐에
 *                                갇히지 않는다. (8b) 지연 임무 에스컬레이션.
 *                                전파 기계는 LIVE에서만 돈다(ADR-41 D9).
 *   journal fact consistency  — (10) 일지 사실칸이 확정 판·실행 로그와 같다.
 *
 * (13)·(15)는 **경계**를 묻는다 — 이어진 뒤에도 참인가. ADR-46 D1~D3이 여기서
 * 나왔다.
 *
 * 테스트는 **순서대로** 돈다. 훈련은 상태를 쌓아 가는 일이고, 매 단계를 독립
 * 시나리오로 만들면 정확히 이 항목이 찾으려는 것(단계 사이의 어긋남)을 잃는다.
 */

/** 훈련 하나가 굴러가며 쌓는 것. 각 단계가 채우고 다음 단계가 읽는다. */
interface Exercise {
  situationId: string;
  factIds: string[];
  snapshotId: string;
  knowledgeDocumentId: string;
  evidenceSetId: string;
  sopId: string;
  generatedVersionId: string;
  approvedVersionId: string;
  runId: string;
  /** ACTION 노드에서 나온 임무들. 순서는 흐름 순서다. */
  taskIds: string[];
  journalId: string;
  evaluationId: string;
  /** 종료가 남긴 기준선 사건. (13)이 이것과 지금을 견준다. */
  baselineEventId: string;
}

const TEMPLATE = resolve(TEMPLATE_DIR, '간략 보고 양식.hwpx');

describe.skipIf(!ADMIN_URL)('상황–SOP–일지 수직 슬라이스 (CC-320)', () => {
  let h: Harness;
  let api: ReturnType<typeof apiFor>;
  let adminToken: string;
  let fieldToken: string;
  let field2Token: string;

  /** 훈련 하나. 단계가 순서대로 채운다. */
  const ex = {} as Exercise;

  const errorCode = async (res: Response): Promise<string> => {
    const parsed = (await res.json()) as { error?: { code?: string } };
    return parsed.error?.code ?? 'NO_CODE';
  };

  /** 실패했을 때 본문을 보여 준다 — 상태 코드만으로는 어디서 어긋났는지 모른다. */
  const expectStatus = async (res: Response, expected: number, label: string): Promise<void> => {
    if (res.status !== expected) {
      const text = await res.clone().text();
      throw new Error(`[${label}] 기대 ${expected}, 실제 ${res.status}: ${text.slice(0, 800)}`);
    }
  };

  const uploadFile = async (
    name: string,
    bytes: Buffer,
    mimeType: string,
    purpose: string,
  ): Promise<string> => {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const reg = await api.call('POST', '/api/v1/files', adminToken, {
      body: { fileName: name, sizeBytes: bytes.length, mimeType, sha256, purpose },
      idempotencyKey: idem('file'),
    });
    await expectStatus(reg, 201, `파일 등록 ${name}`);
    const registration = (await reg.json()) as {
      data: { file: { fileId: string }; upload: { url: string; headers: Record<string, string> } };
    };
    const fileId = registration.data.file.fileId;
    const ticket = new URL(registration.data.upload.url).searchParams.get('token') ?? '';
    const sent = await fetch(
      `${h.base}/api/v1/files/${fileId}/content?token=${encodeURIComponent(ticket)}`,
      { method: 'PUT', headers: registration.data.upload.headers, body: bytes },
    );
    expect(sent.status).toBe(204);
    const done = await api.call('POST', `/api/v1/files/${fileId}/complete`, adminToken, {
      body: { etag: `"${name}"` },
      idempotencyKey: idem('complete'),
    });
    await expectStatus(done, 200, `파일 완료 ${name}`);
    return fileId;
  };

  const taskStatuses = async (): Promise<Record<string, string>> =>
    withClient(h.dbUrl, async (c) => {
      const rows = await c.query(`SELECT t.task_id, t.status FROM task t WHERE t.run_id = $1`, [
        ex.runId,
      ]);
      return Object.fromEntries(
        rows.rows.map((r: { task_id: string; status: string }) => [r.task_id, r.status]),
      ) as Record<string, string>;
    });

  beforeAll(async () => {
    h = await startHarness('cc320_e2e');
    api = apiFor(h);
    adminToken = await api.login(h.fixtures.tenantA, 'admin-a');
    fieldToken = await api.login(h.fixtures.tenantA, 'field-a');
    field2Token = await api.login(h.fixtures.tenantA, 'field-a2');
  }, 180_000);

  afterAll(async () => {
    await h?.close();
  });

  // ── (1) 상황 등록 ────────────────────────────────────────────────────────

  it('(1) 훈련 상황을 등록한다', async () => {
    const res = await api.call('POST', '/api/v1/situations', adminToken, {
      body: {
        mode: 'EXERCISE',
        title: 'CC-320 수직 슬라이스 훈련',
        hazardType: '태풍/호우',
        locationText: '○○시 ○○동',
      },
      idempotencyKey: idem('situation'),
    });
    await expectStatus(res, 201, '상황 등록');
    const body = (await res.json()) as { data: { situationId: string; status: string } };
    ex.situationId = body.data.situationId;
    expect(body.data.status).toBe('DRAFT');
  }, 120_000);

  // ── (2) 사실 수집과 충돌 해소 ────────────────────────────────────────────

  it('(2) 사실을 모으고, 값이 갈리면 사람이 고른다', async () => {
    const observedAt = new Date(Date.now() - 600_000).toISOString();
    const addFact = async (body: Record<string, unknown>): Promise<string> => {
      const res = await api.call('POST', `/api/v1/situations/${ex.situationId}/facts`, adminToken, {
        body,
        idempotencyKey: idem('fact'),
      });
      await expectStatus(res, 201, `사실 등록 ${String(body.factKey)}`);
      return ((await res.json()) as { data: { factId: string } }).data.factId;
    };

    // 같은 표준 Key에 두 값이 온다 — 충돌을 **만들어서** 해소 경로를 태운다.
    const rainA = await addFact({
      factType: 'WEATHER_OBSERVATION',
      factKey: 'rainfall_1h',
      value: 42,
      unit: 'mm',
      observedAt,
      source: { sourceName: '기상청 관측' },
    });
    const rainB = await addFact({
      // **같은 factType·factKey여야 충돌이다** — 종류가 다르면 다른 사실이다.
      factType: 'WEATHER_OBSERVATION',
      factKey: 'rainfall_1h',
      value: 55,
      unit: 'mm',
      observedAt,
      source: { sourceName: '현장 보고' },
    });
    const damage = await addFact({
      factType: 'FIELD_REPORT',
      factKey: 'location',
      value: '○○시 ○○동 저지대',
      observedAt,
      source: { sourceName: '현장 보고' },
    });

    const dedup = await api.call(
      'POST',
      `/api/v1/situations/${ex.situationId}/facts/deduplicate`,
      adminToken,
      { body: {}, idempotencyKey: idem('dedup') },
    );
    await expectStatus(dedup, 200, '중복·충돌 계산');
    const conflicts = (await dedup.json()) as {
      data: { conflictsOpened: number; conflicts: Array<{ conflictId: string }> };
    };
    // 갈린 값을 **자동으로** 고르지 않는다 — 사람이 고를 일이 남아야 한다.
    expect(conflicts.data.conflicts.length).toBeGreaterThan(0);

    for (const conflict of conflicts.data.conflicts) {
      const resolved = await api.call(
        'POST',
        `/api/v1/situations/${ex.situationId}/conflicts/${conflict.conflictId}/resolve`,
        adminToken,
        {
          body: { selectedFactId: rainA, reason: '기상청 관측값을 채택한다' },
          idempotencyKey: idem('resolve'),
        },
      );
      await expectStatus(resolved, 200, '충돌 해소');
    }

    ex.factIds = [rainA, damage];
    expect(rainB).not.toBe(rainA);
  }, 120_000);

  // ── (3) 판 확정 ──────────────────────────────────────────────────────────

  it('(3) 확정 판이 생기고 상황이 CONTEXT_CONFIRMED가 된다', async () => {
    const res = await api.call(
      'POST',
      `/api/v1/situations/${ex.situationId}/snapshots`,
      adminToken,
      {
        body: {
          factIds: ex.factIds,
          effectiveAt: new Date().toISOString(),
          expectedSnapshotId: null,
        },
        idempotencyKey: idem('snapshot'),
      },
    );
    await expectStatus(res, 201, '판 확정');
    const body = (await res.json()) as {
      data: { snapshotId: string; versionNo: number; contentHash: string };
    };
    ex.snapshotId = body.data.snapshotId;
    expect(body.data.versionNo).toBe(1);
    expect(body.data.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const detail = await api.call('GET', `/api/v1/situations/${ex.situationId}`, adminToken);
    await expectStatus(detail, 200, '상황 상세');
    const situation = (await detail.json()) as { data: { status: string } };
    expect(situation.data.status).toBe('CONTEXT_CONFIRMED');
  }, 120_000);

  // ── (4) 지식문서 → 근거집합 ──────────────────────────────────────────────

  it('(4) 지식문서를 올리고 근거를 검색해 동결한다', async () => {
    // ── CC-320 V-1 ────────────────────────────────────────────────────────
    // 여기가 이 항목이 처음 찾은 구멍이다. UNE-KNOW-001은 `fileId`를 받는데
    // **그 fileId를 만들 수 있는 API가 없다** — UNE-DOC-001은 HWPX_IMPORT
    // 용도만 열려 있고(`IMPLEMENTED_PURPOSES`) MIME도 HWPX만 받는다. 즉
    // 지식문서·근거·SOP 생성 전 구간이 API만으로는 도달할 수 없다.
    // 임시로 파일 행을 심어 나머지 구간을 계속 태운다.
    const bytes = Buffer.from('CC-320 풍수해 대응 행동지침: 대피 방송, 통제, 보고.', 'utf8');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const storageKey = `tenants/${h.fixtures.tenantA}/knowledge/${randomUUID()}.pdf`;
    await h.storage.put({ key: storageKey, body: bytes, contentType: 'application/pdf' });
    const fileId = await withClient(h.dbUrl, async (c) => {
      const r = await c.query(
        `INSERT INTO file_object
           (tenant_id, storage_key, original_name, mime_type, size_bytes, sha256,
            scan_status, upload_state, verified_at, created_by)
         VALUES ($1,$2,'풍수해 행동지침.pdf','application/pdf',$3,$4,'CLEAN','VERIFIED',now(),$5)
         RETURNING file_id`,
        [h.fixtures.tenantA, storageKey, bytes.length, sha256, h.fixtures.adminA],
      );
      return r.rows[0].file_id as string;
    });

    const created = await api.call(
      'POST',
      `/api/v1/situations/${ex.situationId}/knowledge-documents`,
      adminToken,
      {
        body: { fileId, documentType: 'MANUAL', retentionScope: 'THIS_INCIDENT' },
        idempotencyKey: idem('knowledge'),
      },
    );
    await expectStatus(created, 202, '지식문서 접수');
    const doc = (await created.json()) as { data: { knowledgeDocumentId: string; status: string } };
    ex.knowledgeDocumentId = doc.data.knowledgeDocumentId;

    // **202는 "됐다"가 아니다.** 워커가 실제로 올려서 READY가 되어야 근거가 된다.
    for (let i = 0; i < 10; i += 1) {
      await h.knowledge.runOnce();
      await h.knowledge.pollOnce();
      const status = await withClient(
        h.dbUrl,
        async (c) =>
          (
            await c.query(
              `SELECT uni_status FROM knowledge_document WHERE knowledge_document_id=$1`,
              [ex.knowledgeDocumentId],
            )
          ).rows[0]?.uni_status as string | undefined,
      );
      if (status === 'READY') break;
    }
    const finalStatus = await withClient(
      h.dbUrl,
      async (c) =>
        (
          await c.query(
            `SELECT uni_status FROM knowledge_document WHERE knowledge_document_id=$1`,
            [ex.knowledgeDocumentId],
          )
        ).rows[0]?.uni_status as string,
    );
    expect(finalStatus, '워커가 지식문서를 UNI에 올려야 근거 검색이 가능하다').toBe('READY');

    const search = await api.call(
      'POST',
      `/api/v1/situations/${ex.situationId}/evidence-searches`,
      adminToken,
      {
        body: { snapshotId: ex.snapshotId, query: '침수 지역 대피 절차', topK: 5 },
        idempotencyKey: idem('search'),
      },
    );
    await expectStatus(search, 200, '근거 검색');
    const set = (await search.json()) as {
      data: { evidenceSetId: string; status: string; items: unknown[] };
    };
    ex.evidenceSetId = set.data.evidenceSetId;
    expect(set.data.items.length).toBeGreaterThan(0);

    const lock = await api.call(
      'POST',
      `/api/v1/evidence-sets/${ex.evidenceSetId}/lock`,
      adminToken,
      {
        body: { reason: 'SOP 생성 근거로 고정' },
        idempotencyKey: idem('lock'),
      },
    );
    await expectStatus(lock, 200, '근거 동결');
    expect(((await lock.json()) as { data: { status: string } }).data.status).toBe('FROZEN');
  }, 180_000);

  // ── (5) SOP 생성 → 캔버스 → 승인 ─────────────────────────────────────────

  it('(5) 확정 판과 동결 근거로 SOP를 생성한다', async () => {
    const res = await api.call(
      'POST',
      `/api/v1/situations/${ex.situationId}/sop-generation-jobs`,
      adminToken,
      {
        body: {
          snapshotId: ex.snapshotId,
          evidenceSetId: ex.evidenceSetId,
          schemaVersion: '1.0',
        },
        idempotencyKey: idem('sop-job'),
      },
    );
    await expectStatus(res, 201, 'SOP 생성 접수');
    const job = (await res.json()) as { data: { jobId: string; status: string } };
    expect(job.data.status).toBe('QUEUED');

    for (let i = 0; i < 10; i += 1) {
      await h.sop.runOnce();
      const status = await withClient(
        h.dbUrl,
        async (c) =>
          (await c.query(`SELECT status FROM generation_job WHERE job_id=$1`, [job.data.jobId]))
            .rows[0].status as string,
      );
      if (status !== 'QUEUED' && status !== 'RUNNING') break;
    }

    const stream = await api.call(
      'GET',
      `/api/v1/sop-generation-jobs/${job.data.jobId}/events`,
      adminToken,
    );
    await expectStatus(stream, 200, 'SOP 생성 스트림');
    const frames = await stream.text();
    expect(frames).toContain('event: job.completed');
    const completed = frames
      .split('\n\n')
      .find((f) => f.includes('event: job.completed')) as string;
    const payload = JSON.parse(completed.slice(completed.indexOf('data: ') + 6)) as {
      payload: { sopId: string; sopVersionId: string; graphViolations: string[] };
    };
    ex.sopId = payload.payload.sopId;
    ex.generatedVersionId = payload.payload.sopVersionId;
    expect(payload.payload.graphViolations).toEqual([]);
  }, 180_000);

  it('(5b) 캔버스에서 임무를 셋으로 늘리고 승인한다', async () => {
    const nodes = [
      { nodeKey: 'start', nodeType: 'START', title: '상황 접수' },
      {
        nodeKey: 'a1',
        nodeType: 'ACTION',
        title: '대피 방송',
        tasks: [{ instruction: '저지대 대피 방송 송출', assigneeHint: '상황실' }],
      },
      {
        nodeKey: 'a2',
        nodeType: 'ACTION',
        title: '도로 통제',
        tasks: [{ instruction: '침수 구간 차량 통제', assigneeHint: '교통팀' }],
      },
      {
        nodeKey: 'a3',
        nodeType: 'ACTION',
        title: '피해 집계 보고',
        tasks: [{ instruction: '피해 현황 집계 후 보고', assigneeHint: '상황실' }],
      },
      { nodeKey: 'fin', nodeType: 'END', title: '종료' },
    ];
    const edges = [
      { fromNodeKey: 'start', toNodeKey: 'a1', priority: 0 },
      { fromNodeKey: 'a1', toNodeKey: 'a2', priority: 0 },
      { fromNodeKey: 'a2', toNodeKey: 'a3', priority: 0 },
      { fromNodeKey: 'a3', toNodeKey: 'fin', priority: 0 },
    ];

    const saved = await api.call('POST', `/api/v1/sops/${ex.sopId}/versions`, adminToken, {
      body: { baseVersionId: ex.generatedVersionId, nodes, edges },
      idempotencyKey: idem('sop-save'),
    });
    await expectStatus(saved, 201, '캔버스 저장');
    const version = (await saved.json()) as { data: { sopVersionId: string; versionNo: number } };
    ex.approvedVersionId = version.data.sopVersionId;
    // 저장은 덮어쓰지 않는다 — 생성본은 그대로 남는다.
    expect(ex.approvedVersionId).not.toBe(ex.generatedVersionId);

    const validated = await api.call('POST', `/api/v1/sops/${ex.sopId}/validate`, adminToken, {
      body: { versionId: ex.approvedVersionId },
    });
    await expectStatus(validated, 200, 'SOP 검증');
    const report = (await validated.json()) as { data: { status: string; errors: unknown[] } };
    expect(report.data.status, JSON.stringify(report.data.errors)).toBe('PASS');

    const review = await api.call('POST', `/api/v1/sops/${ex.sopId}/submit-review`, adminToken, {
      body: { versionId: ex.approvedVersionId, reviewers: [h.fixtures.readerA] },
      idempotencyKey: idem('sop-review'),
    });
    await expectStatus(review, 201, '검토 요청');

    const approved = await api.call('POST', `/api/v1/sops/${ex.sopId}/approve`, adminToken, {
      body: { versionId: ex.approvedVersionId, comment: '훈련 시행 승인' },
      idempotencyKey: idem('sop-approve'),
    });
    await expectStatus(approved, 200, 'SOP 승인');
    expect(((await approved.json()) as { data: { status: string } }).data.status).toBe('LOCKED');
  }, 180_000);

  // ── (6) 실행 시작 — 임무 여럿 ────────────────────────────────────────────

  it('(6) 실행을 시작하면 ACTION마다 임무가 생기고 첫 임무만 열린다', async () => {
    const res = await api.call('POST', `/api/v1/sops/${ex.sopId}/runs`, adminToken, {
      body: {
        approvedVersionId: ex.approvedVersionId,
        snapshotId: ex.snapshotId,
        mode: 'EXERCISE',
      },
      idempotencyKey: idem('run'),
    });
    await expectStatus(res, 201, '실행 시작');
    ex.runId = ((await res.json()) as { data: { runId: string } }).data.runId;

    const detail = await api.call('GET', `/api/v1/sop-runs/${ex.runId}`, adminToken);
    await expectStatus(detail, 200, '실행 상세');
    const run = (await detail.json()) as {
      data: {
        status: string;
        activeNodeKeys: string[];
        tasks: Array<{ taskId: string; nodeKey: string; status: string }>;
      };
    };
    // **다수 임무** — 수용 기준 2.
    expect(run.data.tasks.map((t) => t.nodeKey)).toEqual(['a1', 'a2', 'a3']);
    // 만들어진 임무와 지금 할 임무는 다르다.
    expect(run.data.activeNodeKeys).toEqual(['a1']);
    ex.taskIds = run.data.tasks.map((t) => t.taskId);

    // 훈련 상황은 실행이 시작되면 RUNNING이다.
    const situation = await api.call('GET', `/api/v1/situations/${ex.situationId}`, adminToken);
    expect(((await situation.json()) as { data: { status: string } }).data.status).toBe('RUNNING');
  }, 120_000);

  // ── (7) 전파: 실패 → 재시도 → dead letter ────────────────────────────────

  it('(7) 훈련 실행은 전파하지 않는다 (ADR-41 D9)', async () => {
    // 담당자를 붙인다 — 배정 없는 임무는 현장이 집을 수 없다.
    for (const [index, taskId] of ex.taskIds.entries()) {
      const assignee = index === 2 ? h.fixtures.fieldA2 : h.fixtures.fieldA;
      const res = await api.call('POST', `/api/v1/tasks/${taskId}/reassign`, adminToken, {
        body: { assigneeId: assignee, reason: '훈련 담당 배정' },
        idempotencyKey: idem('assign'),
      });
      await expectStatus(res, 201, `임무 배정 ${index}`);
    }

    // 훈련이 실제 문자를 보내면 훈련이 아니다. 여기서 막히는 것이 정본이다.
    const dispatched = await api.call(
      'POST',
      `/api/v1/tasks/${ex.taskIds[0]}/dispatch`,
      adminToken,
      {
        body: {
          channels: ['SYSTEM', 'SMS'],
          recipients: [{ userId: h.fixtures.fieldA }],
          messageTemplate: '대피 방송을 시행하십시오.',
        },
        idempotencyKey: idem('dispatch'),
      },
    );
    expect(dispatched.status).toBe(412);
    expect(await errorCode(dispatched)).toBe('TASK-412-001');

    // 막혔으면 큐에도 아무것도 없어야 한다 — 거절과 조용한 적재는 다르다.
    const queued = await withClient(
      h.dbUrl,
      async (c) =>
        (await c.query(`SELECT count(*)::int n FROM dispatch WHERE task_id = $1`, [ex.taskIds[0]]))
          .rows[0].n as number,
    );
    expect(queued).toBe(0);
  }, 180_000);

  // ── (8) 현장 수행과 에스컬레이션 ─────────────────────────────────────────

  it('(8) 첫 임무를 이행하고 승인해야 다음 임무가 열린다', async () => {
    const post = async (taskId: string, action: string, body: unknown, token: string) =>
      api.call('POST', `/api/v1/tasks/${taskId}/${action}`, token, {
        body,
        idempotencyKey: idem(action),
      });

    const ack = await post(ex.taskIds[0], 'acknowledge', {}, fieldToken);
    await expectStatus(ack, 201, '수신 확인');
    const start = await post(ex.taskIds[0], 'start', { note: '방송 준비' }, fieldToken);
    await expectStatus(start, 201, '착수');
    const progress = await post(
      ex.taskIds[0],
      'progress',
      { progress: 60, note: '1차 방송 완료' },
      fieldToken,
    );
    await expectStatus(progress, 201, '진행');
    const complete = await post(
      ex.taskIds[0],
      'complete',
      { result: '저지대 3개 구역 대피 방송 송출 완료' },
      fieldToken,
    );
    await expectStatus(complete, 201, '완료 보고');

    // **현장의 "했다"는 아직 완료가 아니다** — 감독이 받아야 흐름이 넘어간다.
    const beforeApproval = await api.call('GET', `/api/v1/sop-runs/${ex.runId}`, adminToken);
    const pending = (await beforeApproval.json()) as { data: { activeNodeKeys: string[] } };
    expect(pending.data.activeNodeKeys).toEqual(['a1']);

    const approved = await post(
      ex.taskIds[0],
      'approve-completion',
      { comment: '방송 확인함' },
      adminToken,
    );
    await expectStatus(approved, 201, '완료 승인');

    const detail = await api.call('GET', `/api/v1/sop-runs/${ex.runId}`, adminToken);
    const run = (await detail.json()) as { data: { activeNodeKeys: string[] } };
    // **다음 임무가 열려야 흐름이다** — 완료가 다음을 깨우지 않으면 실행은 멈춘다.
    expect(run.data.activeNodeKeys).toEqual(['a2']);
  }, 120_000);

  it('(8b) 지연된 임무는 에스컬레이션된다 — 훈련에서도 기록은 남는다', async () => {
    const escalated = await api.call(
      'POST',
      `/api/v1/tasks/${ex.taskIds[1]}/escalate`,
      adminToken,
      {
        body: { reason: '도로 통제 착수 지연', level: 'L1', targetIds: [h.fixtures.adminA] },
        idempotencyKey: idem('escalate'),
      },
    );
    await expectStatus(escalated, 201, '에스컬레이션');

    // 에스컬레이션이 훈련에서 무엇을 하는지 고정한다. 전파가 만들어졌다면
    // ADR-41 D9를 비껴간 것이고, 만들어지지 않았다면 기록만 남은 것이다.
    const rows = await withClient(h.dbUrl, async (c) => {
      const r = await c.query(
        `SELECT d.message_type, count(m.outbox_id)::int AS queued
           FROM dispatch d
           LEFT JOIN dispatch_recipient dr ON dr.dispatch_id = d.dispatch_id
           LEFT JOIN outbox_message m ON m.dispatch_recipient_id = dr.recipient_id
          WHERE d.task_id = $1
          GROUP BY d.message_type`,
        [ex.taskIds[1]],
      );
      return r.rows as Array<{ message_type: string; queued: number }>;
    });
    // 훈련 실행이므로 바깥으로 나가는 것은 없어야 한다(7과 같은 판단).
    expect(rows, '훈련 실행의 에스컬레이션이 전파를 만들면 ADR-41 D9가 비껴간 것이다').toEqual([]);

    // 실행 로그에는 남는다 — 훈련도 평가 대상이다.
    const escalationEvents = await withClient(
      h.dbUrl,
      async (c) =>
        (
          await c.query(
            `SELECT count(*)::int n FROM execution_event
              WHERE situation_id=$1 AND event_type LIKE '%ESCALAT%'`,
            [ex.situationId],
          )
        ).rows[0].n as number,
    );
    expect(escalationEvents).toBeGreaterThan(0);

    // 나머지 임무를 정리한다 — 종료 게이트가 볼 미결을 남기지 않기 위해서다.
    const post = async (taskId: string, action: string, body: unknown, token: string) =>
      api.call('POST', `/api/v1/tasks/${taskId}/${action}`, token, {
        body,
        idempotencyKey: idem(action),
      });
    const settle = async (taskId: string, token: string, result: string, label: string) => {
      // 전파된 임무는 **수신 확인부터** 시작한다 — SENT에서 곧장 착수할 수 없다.
      await expectStatus(await post(taskId, 'acknowledge', {}, token), 201, `${label} 수신`);
      await expectStatus(await post(taskId, 'start', {}, token), 201, `${label} 착수`);
      await expectStatus(await post(taskId, 'complete', { result }, token), 201, `${label} 완료`);
      await expectStatus(
        await post(taskId, 'approve-completion', { comment: '확인함' }, adminToken),
        201,
        `${label} 완료 승인`,
      );
    };
    await settle(ex.taskIds[1], fieldToken, '침수 구간 통제 완료', '2번');
    await settle(ex.taskIds[2], field2Token, '피해 12건 집계 보고', '3번');

    const statuses = await taskStatuses();
    expect(Object.values(statuses).every((s) => s === 'COMPLETED')).toBe(true);
  }, 180_000);

  // ── (9) 실행 로그와 대시보드 ─────────────────────────────────────────────

  it('(9) 실행 로그가 append-only로 쌓이고 대시보드가 그것으로만 센다', async () => {
    const events = await api.call(
      'GET',
      `/api/v1/situations/${ex.situationId}/execution-events?size=200`,
      adminToken,
    );
    await expectStatus(events, 200, '실행 로그');
    const log = (await events.json()) as {
      data: { items: Array<{ eventId: string; eventType: string }> };
    };
    const types = new Set(log.data.items.map((e) => e.eventType));
    for (const expected of [
      'TASK_ACKNOWLEDGED',
      'TASK_STARTED',
      'TASK_COMPLETED',
      'TASK_ESCALATED',
    ]) {
      expect(types, `실행 로그에 ${expected}가 있어야 한다: ${[...types].join(',')}`).toContain(
        expected,
      );
    }

    const dashboard = await api.call(
      'GET',
      `/api/v1/situations/${ex.situationId}/dashboard`,
      adminToken,
    );
    await expectStatus(dashboard, 200, '대시보드');
    const board = (await dashboard.json()) as {
      data: { kpi: { total: number; completed: number; inProgress: number } };
    };
    // 집계는 CC-290의 한 산출기에서만 온다(ADR-43 D1). 임무 셋이 다 끝났다.
    expect(board.data.kpi.total).toBe(3);
    expect(board.data.kpi.completed).toBe(3);
    expect(board.data.kpi.inProgress).toBe(0);
  }, 120_000);

  // ── (10) 일지 — 사실 일관성 ──────────────────────────────────────────────

  it('(10) 일지 사실칸은 확정 판과 실행 로그에서만 온다', async () => {
    const templateFileId = await uploadFile(
      '간략 상황보고 양식.hwpx',
      readFileSync(TEMPLATE),
      'application/hwp+zip',
      'HWPX_IMPORT',
    );

    const projected = await api.call(
      'POST',
      `/api/v1/situations/${ex.situationId}/journal-projections`,
      adminToken,
      {
        body: {
          snapshotId: ex.snapshotId,
          templateFileId,
          from: new Date(Date.now() - 7_200_000).toISOString(),
          to: new Date(Date.now() + 3_600_000).toISOString(),
        },
        idempotencyKey: idem('project'),
      },
    );
    await expectStatus(projected, 201, '일지 투영');
    const journal = (await projected.json()) as { data: { journal: { journalId: string } } };
    ex.journalId = journal.data.journal.journalId;

    const detail = await api.call('GET', `/api/v1/journals/${ex.journalId}`, adminToken);
    await expectStatus(detail, 200, '일지 상세');
    const body = (await detail.json()) as {
      data: {
        journal: { snapshotId: string; drifted: boolean };
        cells: Array<{
          sectionKey: string;
          factRows: Array<{ label: string; value: string }>;
          lockedFields: string[];
          sourceEventIds: string[];
          narrativeSource: string;
        }>;
      };
    };
    // 사실칸이 가리키는 판은 우리가 확정한 그 판이다.
    expect(body.data.journal.snapshotId).toBe(ex.snapshotId);
    expect(body.data.cells.length).toBeGreaterThan(0);
    // 사실칸은 잠겨 있다 — 사람도 AI도 여기에 쓸 수 없다(ADR-44).
    expect(body.data.cells.some((c) => c.lockedFields.length > 0)).toBe(true);
    // 실행 로그에서 온 칸은 자기가 어떤 사건에서 왔는지 말할 수 있어야 한다.
    expect(body.data.cells.some((c) => c.sourceEventIds.length > 0)).toBe(true);

    // **수용 기준 4** — 일지가 든 사실이 확정 판이 든 사실과 같은가.
    const snapshotFacts = await withClient(h.dbUrl, async (c) => {
      const r = await c.query(`SELECT facts_json FROM situation_snapshot WHERE snapshot_id=$1`, [
        ex.snapshotId,
      ]);
      return r.rows[0].facts_json as Array<Record<string, unknown>>;
    });
    const rendered = JSON.stringify(body.data.cells);
    let compared = 0;
    for (const fact of snapshotFacts) {
      const value = (fact.normalizedValue ?? fact.value) as unknown;
      if (typeof value === 'string' && value.length > 3) {
        compared += 1;
        expect(rendered, `확정 판의 사실 "${value}"가 일지에 없다`).toContain(value);
      }
    }
    expect(
      compared,
      '대조할 사실이 하나도 없으면 이 단언은 아무것도 증명하지 않는다',
    ).toBeGreaterThan(0);
  }, 180_000);

  it('(10b) 일지를 승인하면 문서가 얼고, 그 뒤 사실칸은 못 고친다', async () => {
    const review = await api.call(
      'POST',
      `/api/v1/journals/${ex.journalId}/submit-review`,
      adminToken,
      {
        body: { reviewers: [h.fixtures.readerA] },
        idempotencyKey: idem('jnl-review'),
      },
    );
    await expectStatus(review, 201, '일지 검토요청');

    const approve = await api.call('POST', `/api/v1/journals/${ex.journalId}/approve`, adminToken, {
      body: { comment: '확인함' },
      idempotencyKey: idem('jnl-approve'),
    });
    await expectStatus(approve, 201, '일지 승인');
    const approved = (await approve.json()) as { data: { journal: { status: string } } };
    expect(approved.data.journal.status).toBe('APPROVED');
  }, 120_000);

  // ── (11) 종료와 평가 ─────────────────────────────────────────────────────

  it('(11) 종료 게이트가 미결을 목록으로 보여 주고, 정리되면 닫힌다', async () => {
    const preview = await api.call(
      'GET',
      `/api/v1/situations/${ex.situationId}/close-preview`,
      adminToken,
    );
    await expectStatus(preview, 200, '종료 미리보기');
    const gate = (await preview.json()) as {
      data: { closable: boolean; blockers: Array<{ kind: string; refId: string; detail: string }> };
    };

    // 실행이 아직 돌고 있다 — 임무는 다 끝났지만 실행을 끝낸 사람이 없다.
    const dispositions = gate.data.blockers
      .filter((b) => b.kind !== 'QUEUED_DISPATCH')
      .map((b) => ({ refId: b.refId, disposition: 'WAIVED', reason: '훈련 종료 시점 정리' }));

    const closed = await api.call(
      'POST',
      `/api/v1/situations/${ex.situationId}/close`,
      adminToken,
      {
        body: { resultSummary: 'CC-320 수직 슬라이스 훈련 종료', dispositions },
        idempotencyKey: idem('close'),
      },
    );
    await expectStatus(closed, 200, '훈련 종료');
    const result = (await closed.json()) as { data: { status: string; closedAt: string } };
    expect(result.data.status).toBe('CLOSED');

    const baseline = await withClient(h.dbUrl, async (c) => {
      const r = await c.query(
        `SELECT execution_event_id, payload_json
           FROM execution_event
          WHERE situation_id = $1 AND event_type = 'SITUATION_CLOSED'
          ORDER BY occurred_at DESC LIMIT 1`,
        [ex.situationId],
      );
      return r.rows[0] as { execution_event_id: string; payload_json: Record<string, unknown> };
    });
    expect(baseline, '종료는 기준선을 사건으로 남긴다').toBeDefined();
    ex.baselineEventId = baseline.execution_event_id;
  }, 180_000);

  it('(12) 평가는 CC-290 산출기의 지표를 고정해서 담는다', async () => {
    const anyEvent = await withClient(h.dbUrl, async (c) => {
      const r = await c.query(
        `SELECT execution_event_id FROM execution_event
          WHERE situation_id = $1 AND event_type = 'TASK_COMPLETED' LIMIT 1`,
        [ex.situationId],
      );
      return r.rows[0].execution_event_id as string;
    });

    const res = await api.call(
      'POST',
      `/api/v1/situations/${ex.situationId}/evaluations`,
      adminToken,
      {
        body: {
          summary: '전파·이행 모두 기준 안에서 진행됨',
          scores: [
            {
              criterionCode: 'DISPATCH_TIME',
              scoreValue: 85,
              weightValue: 1,
              comment: '전파는 기준 안에 들어왔다.',
              evidenceEventIds: [anyEvent],
            },
          ],
        },
        idempotencyKey: idem('evaluate'),
      },
    );
    await expectStatus(res, 201, '평가 생성');
    const evaluation = (await res.json()) as {
      data: { evaluationId: string; metrics: Record<string, unknown> };
    };
    ex.evaluationId = evaluation.data.evaluationId;
    expect(evaluation.data.metrics.completionRate).toBe(1);

    const improvement = await api.call(
      'POST',
      `/api/v1/evaluations/${ex.evaluationId}/improvements`,
      adminToken,
      {
        body: {
          actions: [
            {
              actionText: '도로 통제 인력 사전 배치 절차를 SOP에 넣는다.',
              ownerUserId: h.fixtures.adminA,
            },
          ],
        },
        idempotencyKey: idem('improve'),
      },
    );
    await expectStatus(improvement, 201, '개선조치');

    const confirmed = await api.call(
      'POST',
      `/api/v1/evaluations/${ex.evaluationId}/confirm`,
      adminToken,
      { body: {}, idempotencyKey: idem('confirm') },
    );
    await expectStatus(confirmed, 200, '평가 확정');

    const report = await api.call(
      'GET',
      `/api/v1/evaluations/${ex.evaluationId}/report`,
      adminToken,
    );
    await expectStatus(report, 200, '평가보고서');
    const doc = (await report.json()) as { data: Record<string, unknown> };
    expect(JSON.stringify(doc.data)).toContain('NOT_COLLECTED');
  }, 180_000);

  // ── (13) 경계에서 어긋나는 것 ────────────────────────────────────────────
  //
  // 여기부터가 이 항목의 목적이다. 위까지는 "이어진다"를 보였고, 아래는
  // **이어진 뒤에도 참인가**를 묻는다. ADR-45 수용 한계 12·13이 후보다.

  it('(13) 종료 뒤에는 기준선이 담은 것이 바뀌지 않거나, 바뀌면 드러난다', async () => {
    // 종료가 남긴 기준선은 사실원장만이 아니라 **일지 해시와 확정 판**까지 담는다.
    const payload = await withClient(h.dbUrl, async (c) => {
      const r = await c.query(
        `SELECT payload_json FROM execution_event WHERE execution_event_id=$1`,
        [ex.baselineEventId],
      );
      return r.rows[0].payload_json as Record<string, unknown>;
    });
    expect(payload).toBeDefined();

    // ── 여는 것 ──────────────────────────────────────────────────────────
    // 이미 승인돼 얼어붙은 판의 Export는 막지 않는다. 같은 내용을 다시 뽑는
    // 일이므로 기준선을 흔들지 않고, 감사 제출·재인쇄가 정확히 종료 뒤에
    // 필요한 일이다(ADR-46 D3).
    const exported = await api.call(
      'POST',
      `/api/v1/journals/${ex.journalId}/exports`,
      adminToken,
      {
        body: {},
        idempotencyKey: idem('post-close-export'),
      },
    );
    expect(exported.status, '종료된 훈련의 승인 일지는 다시 내보낼 수 있어야 한다').toBe(202);

    // ── 막는 것 ──────────────────────────────────────────────────────────
    // 기준선이 담은 것을 **바꾸는** 연산은 전부 막힌다(ADR-46 D2).
    const post = async (path: string, body: unknown): Promise<Response> =>
      api.call('POST', path, adminToken, { body, idempotencyKey: idem('post-close') });

    const newProjection = await post(`/api/v1/situations/${ex.situationId}/journal-projections`, {
      snapshotId: ex.snapshotId,
      templateFileId: await uploadFile(
        '간략 보고 양식.hwpx',
        readFileSync(TEMPLATE),
        'application/hwp+zip',
        'HWPX_IMPORT',
      ),
      from: new Date(Date.now() - 3_600_000).toISOString(),
      to: new Date().toISOString(),
    });
    expect(newProjection.status, '종료 뒤 새 일지 투영').toBe(409);
    expect(await errorCode(newProjection)).toBe('JOURNAL-409-004');

    const edited = await post(`/api/v1/journals/${ex.journalId}/changesets`, {
      baseRevisionId: null,
      operations: [],
    });
    expect(edited.status, '종료 뒤 일지 편집').toBeGreaterThanOrEqual(400);

    const reReview = await post(`/api/v1/journals/${ex.journalId}/submit-review`, {
      reviewers: [h.fixtures.readerA],
    });
    expect(reReview.status, '종료 뒤 일지 검토요청').toBe(409);
    expect(await errorCode(reReview)).toBe('JOURNAL-409-004');

    // 새 확정 판도 막힌다 — 확정 판은 기준선이 이름으로 담는다.
    const newSnapshot = await post(`/api/v1/situations/${ex.situationId}/snapshots`, {
      factIds: ex.factIds,
      effectiveAt: new Date().toISOString(),
      expectedSnapshotId: ex.snapshotId,
    });
    expect(newSnapshot.status, '종료 뒤 새 판 확정').toBeGreaterThanOrEqual(400);

    // DB도 막는다 — API를 지나지 않는 문서 경로(changeset·autosave·Undo)가
    // 일지 문서를 고치지 못해야 한다.
    const documentId = await withClient(
      h.dbUrl,
      async (c) =>
        (await c.query(`SELECT document_id FROM journal WHERE journal_id=$1`, [ex.journalId]))
          .rows[0].document_id as string,
    );
    await expect(
      withClient(h.dbUrl, (c) =>
        c.query(
          `INSERT INTO document_revision (document_id, revision_no, ir_json, content_hash, created_by)
           VALUES ($1, 999, '{}'::jsonb, $2, $3)`,
          [documentId, 'c'.repeat(64), h.fixtures.adminA],
        ),
      ),
    ).rejects.toThrow();
  }, 180_000);

  // ── (14) 전파 기계와 모드 경계 ───────────────────────────────────────────
  //
  // 전파·재시도·dead letter는 LIVE에서만 도는 기계다(ADR-41 D9). 훈련 본류는
  // 그 기계를 지나지 않으므로, 수용 기준 셋(failure/retry)은 실사건 상황에서
  // 증명한다. 같은 자리에서 **모드 경계**도 함께 묻는다.

  /** 실사건 상황 하나를 API로 세운다 — 승인된 SOP까지. */
  const seedLiveSituation = async (
    label: string,
  ): Promise<{ sopId: string; versionId: string; snapshotId: string; situationId: string }> => {
    const created = await api.call('POST', '/api/v1/situations', adminToken, {
      body: { mode: 'LIVE', title: `CC-320 ${label}`, hazardType: '태풍/호우' },
      idempotencyKey: idem('live-situation'),
    });
    await expectStatus(created, 201, `${label} 상황 등록`);
    const situationId = ((await created.json()) as { data: { situationId: string } }).data
      .situationId;

    const fact = await api.call('POST', `/api/v1/situations/${situationId}/facts`, adminToken, {
      body: {
        factType: 'FIELD_REPORT',
        factKey: 'location',
        value: '△△동 침수',
        observedAt: new Date().toISOString(),
      },
      idempotencyKey: idem('live-fact'),
    });
    await expectStatus(fact, 201, `${label} 사실`);
    const factId = ((await fact.json()) as { data: { factId: string } }).data.factId;

    const snapshot = await api.call(
      'POST',
      `/api/v1/situations/${situationId}/snapshots`,
      adminToken,
      {
        body: {
          factIds: [factId],
          effectiveAt: new Date().toISOString(),
          expectedSnapshotId: null,
        },
        idempotencyKey: idem('live-snapshot'),
      },
    );
    await expectStatus(snapshot, 201, `${label} 판 확정`);
    const snapshotId = ((await snapshot.json()) as { data: { snapshotId: string } }).data
      .snapshotId;

    const sop = await api.call('POST', '/api/v1/sops', adminToken, {
      body: { title: `CC-320 ${label} SOP`, hazardType: 'FLOOD', situationId },
      idempotencyKey: idem('live-sop'),
    });
    await expectStatus(sop, 201, `${label} SOP 생성`);
    const sopId = ((await sop.json()) as { data: { sopId: string } }).data.sopId;

    // 첫 버전은 base가 없다 — CC-240 워커가 하는 일을 여기서는 심는다.
    const versionId = await withClient(h.dbUrl, async (c) => {
      const v = await c.query(
        `INSERT INTO sop_version (sop_id, version_no, status, graph_hash, schema_version, created_by)
         VALUES ($1,1,'DRAFT',$2,'uni-sop-1',$3) RETURNING sop_version_id`,
        [sopId, createHash('sha256').update(label).digest('hex'), h.fixtures.adminA],
      );
      const id = v.rows[0].sop_version_id as string;
      const graph = [
        ['st', 'START', '시작'],
        ['a1', 'ACTION', '대피 방송'],
        ['fin', 'END', '종료'],
      ];
      for (const [i, [key, type, title]] of graph.entries()) {
        await c.query(
          `INSERT INTO sop_node (sop_version_id, node_key, node_type, title, config_json, sort_order)
           VALUES ($1,$2,$3,$4,'{}'::jsonb,$5)`,
          [id, key, type, title, i],
        );
      }
      await c.query(`UPDATE sop SET current_version_id=$2, situation_id=$3 WHERE sop_id=$1`, [
        sopId,
        id,
        situationId,
      ]);
      return id;
    });

    const saved = await api.call('POST', `/api/v1/sops/${sopId}/versions`, adminToken, {
      body: {
        baseVersionId: versionId,
        nodes: [
          { nodeKey: 'st', nodeType: 'START', title: '시작' },
          {
            nodeKey: 'a1',
            nodeType: 'ACTION',
            title: '대피 방송',
            tasks: [{ instruction: '방송 송출', assigneeHint: '상황실' }],
          },
          { nodeKey: 'fin', nodeType: 'END', title: '종료' },
        ],
        edges: [
          { fromNodeKey: 'st', toNodeKey: 'a1', priority: 0 },
          { fromNodeKey: 'a1', toNodeKey: 'fin', priority: 0 },
        ],
      },
      idempotencyKey: idem('live-save'),
    });
    await expectStatus(saved, 201, `${label} 캔버스 저장`);
    const approvedId = ((await saved.json()) as { data: { sopVersionId: string } }).data
      .sopVersionId;

    // 검증하지 않은 버전은 승인되지 않는다 — 검증도 경로의 일부다.
    await expectStatus(
      await api.call('POST', `/api/v1/sops/${sopId}/validate`, adminToken, {
        body: { versionId: approvedId },
      }),
      200,
      `${label} 검증`,
    );
    await expectStatus(
      await api.call('POST', `/api/v1/sops/${sopId}/submit-review`, adminToken, {
        body: { versionId: approvedId, reviewers: [h.fixtures.readerA] },
        idempotencyKey: idem('live-review'),
      }),
      201,
      `${label} 검토요청`,
    );
    await expectStatus(
      await api.call('POST', `/api/v1/sops/${sopId}/approve`, adminToken, {
        body: { versionId: approvedId },
        idempotencyKey: idem('live-approve'),
      }),
      200,
      `${label} 승인`,
    );
    return { sopId, versionId: approvedId, snapshotId, situationId };
  };

  it('(14) 실사건 전파는 실패해도 재시도하고, 끝내 못 가면 dead letter로 남는다', async () => {
    const live = await seedLiveSituation('실사건');
    const run = await api.call('POST', `/api/v1/sops/${live.sopId}/runs`, adminToken, {
      body: { approvedVersionId: live.versionId, snapshotId: live.snapshotId, mode: 'LIVE' },
      idempotencyKey: idem('live-run'),
    });
    await expectStatus(run, 201, '실사건 실행');
    const runId = ((await run.json()) as { data: { runId: string } }).data.runId;

    const detail = await api.call('GET', `/api/v1/sop-runs/${runId}`, adminToken);
    const tasks = (await detail.json()) as { data: { tasks: Array<{ taskId: string }> } };
    const taskId = tasks.data.tasks[0].taskId;
    await expectStatus(
      await api.call('POST', `/api/v1/tasks/${taskId}/reassign`, adminToken, {
        body: { assigneeId: h.fixtures.fieldA, reason: '실사건 담당' },
        idempotencyKey: idem('live-assign'),
      }),
      201,
      '실사건 배정',
    );

    const dispatched = await api.call('POST', `/api/v1/tasks/${taskId}/dispatch`, adminToken, {
      body: {
        channels: ['SYSTEM', 'SMS', 'EMAIL'],
        recipients: [{ userId: h.fixtures.fieldA }],
        messageTemplate: '대피 방송을 시행하십시오.',
      },
      idempotencyKey: idem('live-dispatch'),
    });
    await expectStatus(dispatched, 201, '실사건 전파');
    const dispatchId = ((await dispatched.json()) as { data: { dispatchId: string } }).data
      .dispatchId;

    // 접수만으로는 아무 데도 가지 않았다 — 릴레이가 돌아야 큐가 빈다.
    const queuedBefore = await withClient(
      h.dbUrl,
      async (c) =>
        (
          await c.query(
            `SELECT count(*)::int n FROM outbox_message m
               JOIN dispatch_recipient dr ON dr.recipient_id = m.dispatch_recipient_id
              WHERE dr.dispatch_id = $1 AND m.status IN ('PENDING','SENDING')`,
            [dispatchId],
          )
        ).rows[0].n as number,
    );
    expect(queuedBefore, '전파 접수는 큐에 실려야 한다').toBeGreaterThan(0);

    for (let i = 0; i < 40; i += 1) {
      const summary = await h.outbox.runOnce();
      if (summary.claimed === 0) break;
    }

    const outcome = await withClient(h.dbUrl, async (c) => {
      const r = await c.query(
        `SELECT m.status, m.attempt_count, m.channel
           FROM outbox_message m
           JOIN dispatch_recipient dr ON dr.recipient_id = m.dispatch_recipient_id
          WHERE dr.dispatch_id = $1`,
        [dispatchId],
      );
      return r.rows as Array<{ status: string; attempt_count: number; channel: string }>;
    });
    expect(outcome.length).toBeGreaterThan(0);
    // **PENDING/SENDING에 갇힌 것이 없어야 한다** — 나갔거나, 죽었다고 적혔거나.
    expect(
      outcome.filter((m) => m.status === 'PENDING' || m.status === 'SENDING'),
      `큐에 갇힌 메시지가 남았다: ${JSON.stringify(outcome)}`,
    ).toEqual([]);

    const status = await api.call('GET', `/api/v1/dispatches/${dispatchId}`, adminToken);
    await expectStatus(status, 200, '전파 상태');
  }, 240_000);

  it('(15) V-2: 훈련 상황이 LIVE 실행을 받아들이는가', async () => {
    // ── CC-320 V-2 ────────────────────────────────────────────────────────
    // ADR-41 D9는 **`run.mode`**로 전파를 막는다. 그런데 실행을 만드는 쪽은
    // `run.mode`를 **`situation.mode`와 대조하지 않는다**. EXERCISE 상황에서
    // `mode: 'LIVE'`로 실행을 열면 D9의 방어가 통째로 비껴간다 — 훈련이
    // 실제 문자를 보낸다.
    const exercise = await api.call('POST', '/api/v1/situations', adminToken, {
      body: { mode: 'EXERCISE', title: 'CC-320 모드 경계 훈련', hazardType: '태풍/호우' },
      idempotencyKey: idem('mode-situation'),
    });
    await expectStatus(exercise, 201, '모드 경계 훈련 등록');
    const situationId = ((await exercise.json()) as { data: { situationId: string } }).data
      .situationId;

    const live = await seedLiveSituation('모드경계');
    // 위 헬퍼가 만든 SOP를 훈련 상황에 붙인다 — SOP는 상황을 가리킨다.
    await withClient(h.dbUrl, (c) =>
      c.query(`UPDATE sop SET situation_id=$2 WHERE sop_id=$1`, [live.sopId, situationId]),
    );
    // 훈련 상황의 확정 판이 있어야 실행이 선다.
    const fact = await api.call('POST', `/api/v1/situations/${situationId}/facts`, adminToken, {
      body: {
        factType: 'FIELD_REPORT',
        factKey: 'location',
        value: '□□동 훈련 구역',
        observedAt: new Date().toISOString(),
      },
      idempotencyKey: idem('mode-fact'),
    });
    await expectStatus(fact, 201, '모드 경계 사실');
    const factId = ((await fact.json()) as { data: { factId: string } }).data.factId;
    const snap = await api.call('POST', `/api/v1/situations/${situationId}/snapshots`, adminToken, {
      body: { factIds: [factId], effectiveAt: new Date().toISOString(), expectedSnapshotId: null },
      idempotencyKey: idem('mode-snapshot'),
    });
    await expectStatus(snap, 201, '모드 경계 판');
    const snapshotId = ((await snap.json()) as { data: { snapshotId: string } }).data.snapshotId;

    const liveRun = await api.call('POST', `/api/v1/sops/${live.sopId}/runs`, adminToken, {
      body: { approvedVersionId: live.versionId, snapshotId, mode: 'LIVE' },
      idempotencyKey: idem('mode-run'),
    });

    // **훈련 상황에 LIVE 실행이 서면 안 된다** (ADR-46 D1).
    expect(
      liveRun.status,
      '훈련(EXERCISE) 상황에서 LIVE 실행이 만들어지면 ADR-41 D9의 방어가 비껴간다',
    ).toBe(422);
    expect(await errorCode(liveRun)).toBe('SOP-422-009');

    // 훈련 방식 실행은 같은 자리에서 열린다 — 막은 것은 "더 실제인 것"뿐이다.
    const exerciseRun = await api.call('POST', `/api/v1/sops/${live.sopId}/runs`, adminToken, {
      body: { approvedVersionId: live.versionId, snapshotId, mode: 'EXERCISE' },
      idempotencyKey: idem('mode-run-exercise'),
    });
    await expectStatus(exerciseRun, 201, '훈련 방식 실행');

    // DB도 막는다 — API를 지나지 않는 경로가 같은 실수를 하지 못해야 한다.
    await expect(
      withClient(h.dbUrl, (c) =>
        c.query(
          `INSERT INTO sop_run (sop_version_id, situation_id, snapshot_id, mode, status, started_by)
           VALUES ($1,$2,$3,'LIVE','RUNNING',$4)`,
          [live.versionId, situationId, snapshotId, h.fixtures.adminA],
        ),
      ),
    ).rejects.toThrow();
  }, 240_000);
});
