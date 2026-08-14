import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { runner as migrate } from 'node-pg-migrate';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockUniSopAdapter } from '@une/provider-adapters';
import { loadWorkerConfig, type WorkerConfig } from '../config/worker-config';
import { WorkerDatabase } from '../db/worker-database.service';
import { SopJobRunner } from './sop-job.runner';

/**
 * SOP 생성 러너 수용 증거 (CC-240, UNE-SOP-001/002).
 *
 * 증명해야 하는 것.
 *   (1) 워커가 QUEUED SOP 잡을 집어 UNI 스트림을 그래프로 옮기고 DRAFT 버전을 만든다.
 *   (2) **원문 프레임이 남는다** — 성공·실패 모두(provider.responded/failed).
 *   (3) 검증 위반은 **실패가 아니다** — 위반이 있어도 DRAFT로 저장되고 위반이 함께 남는다.
 *   (4) 매핑 거부는 노드 단위다 — 하나가 깨져도 나머지 노드가 살아남는다.
 *   (5) 재생성은 새 SOP가 아니라 **새 버전**이다.
 *   (6) 스트림이 끊기면(`__done__` 없음) 잡이 FAILED로 끝나고 그래프는 생기지 않는다.
 *
 * 다른 워커 e2e와 마찬가지로 superuser로 접속해 `SET LOCAL ROLE`로 강등한다 —
 * 운영에서 그 전환이 실패한다는 사실(OB-17)은 여기서 잡히지 않는다.
 */
const ADMIN_URL = process.env.DATABASE_URL;
const MIGRATIONS_DIR = resolve(process.cwd(), '..', '..', 'database', 'migrations');

async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

interface Fixture {
  tenantId: string;
  userId: string;
  situationId: string;
  snapshotId: string;
  evidenceSetId: string;
  jobId: string;
  /** UNE 문서 id — 저장된 근거 참조가 이 값이어야 한다. */
  knowledgeDocumentId: string;
  /** UNI가 아는 id — 요청 범위에만 쓰인다. */
  providerDocumentId: string;
}

describe.skipIf(!ADMIN_URL)('SOP 생성 러너 e2e (CC-240)', () => {
  let dbName: string;
  let dbUrl: string;
  let config: WorkerConfig;
  let db: WorkerDatabase;

  /** 확정 판 + 동결 근거 + UNI 등록 문서까지 갖춘 상황 하나. */
  const seed = async (
    code: string,
    opts: { prompt?: string; registerDocument?: boolean; freezeEvidence?: boolean } = {},
  ): Promise<Fixture> =>
    withClient(dbUrl, async (c) => {
      const tenantId = (
        await c.query(
          `INSERT INTO tenant (tenant_code, tenant_name, status) VALUES ($1,$1,'ACTIVE')
           RETURNING tenant_id`,
          [code],
        )
      ).rows[0].tenant_id as string;
      const userId = (
        await c.query(
          `INSERT INTO app_user (tenant_id, login_id, display_name, status)
           VALUES ($1,$2,$2,'ACTIVE') RETURNING user_id`,
          [tenantId, `u-${code}`],
        )
      ).rows[0].user_id as string;
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
           VALUES ($1, 1, '[{"factType":"DAMAGE","value":"침수 3개 지구"}]'::jsonb, $2, now(), $3)
           RETURNING snapshot_id`,
          [situationId, createHash('sha256').update(code).digest('hex'), userId],
        )
      ).rows[0].snapshot_id as string;
      await c.query(`UPDATE situation SET current_snapshot_id = $2 WHERE situation_id = $1`, [
        situationId,
        snapshotId,
      ]);

      const sha = createHash('sha256').update(`${code}-file`).digest('hex');
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
           VALUES ($1,$2,$3,'MANUAL',$4,'THIS_INCIDENT',$5,'{}'::jsonb,$6,$7,$8,now())
           RETURNING knowledge_document_id`,
          [
            tenantId,
            situationId,
            fileId,
            opts.registerDocument === false ? 'PENDING_UPLOAD' : 'REGISTERED',
            sha,
            userId,
            opts.registerDocument === false ? null : `uni-${code}`,
            opts.registerDocument === false ? null : 'READY',
          ],
        )
      ).rows[0].knowledge_document_id as string;

      // 근거는 DRAFT로 담고 **그 다음에** 동결한다. 0031의 자식 가드가
      // 동결된 집합에 항목을 넣지 못하게 막는다 — 실제 흐름도 이 순서다.
      const evidenceSetId = (
        await c.query(
          `INSERT INTO evidence_set
             (situation_id, snapshot_id, query_text, filters_json, top_k, status,
              content_hash, created_by)
           VALUES ($1,$2,'대피 절차','{}'::jsonb,5,'DRAFT',$3,$4)
           RETURNING evidence_set_id`,
          [
            situationId,
            snapshotId,
            createHash('sha256').update(`${code}-ev`).digest('hex'),
            userId,
          ],
        )
      ).rows[0].evidence_set_id as string;
      await c.query(
        `INSERT INTO evidence_item
           (evidence_set_id, knowledge_document_id, provider_chunk_id, rank_no, score,
            quote_text, source_locator_json, citation_key)
         VALUES ($1,$2,'c1',1,0.9,'대피 방송을 실시한다','{}'::jsonb,'E1')`,
        [evidenceSetId, documentId],
      );
      if (opts.freezeEvidence !== false) {
        await c.query(
          `UPDATE evidence_set SET status = 'FROZEN', frozen_at = now(), frozen_by = $2
            WHERE evidence_set_id = $1`,
          [evidenceSetId, userId],
        );
      }

      const jobId = (
        await c.query(
          `INSERT INTO generation_job
             (tenant_id, job_type, aggregate_type, aggregate_id, provider_code, request_json,
              status, progress_pct, idempotency_key, correlation_id)
           VALUES ($1,'SOP','SITUATION',$2,'UNI',$3::jsonb,'QUEUED',0,$4,$5)
           RETURNING job_id`,
          [
            tenantId,
            situationId,
            JSON.stringify({
              snapshotId,
              evidenceSetId,
              graphSchemaVersion: '1.0',
              requestedBy: userId,
              // mock 시나리오는 프롬프트가 아니라 요청에서 온다 — 러너가
              // 프롬프트를 만들 때 상황 제목이 들어가므로 제목에 심는다.
            }),
            `idem-${code}-${randomUUID().slice(0, 8)}`,
            `corr-${code}`,
          ],
        )
      ).rows[0].job_id as string;

      if (opts.prompt) {
        await c.query(`UPDATE situation SET title = $2 WHERE situation_id = $1`, [
          situationId,
          opts.prompt,
        ]);
      }

      return {
        tenantId,
        userId,
        situationId,
        snapshotId,
        evidenceSetId,
        jobId,
        knowledgeDocumentId: documentId,
        providerDocumentId: `uni-${code}`,
      };
    });

  const readJob = async (id: string) =>
    withClient(
      dbUrl,
      async (c) =>
        (
          await c.query(
            `SELECT status, progress_pct, error_json, finished_at FROM generation_job
              WHERE job_id = $1`,
            [id],
          )
        ).rows[0],
    );

  const readEvents = async (id: string) =>
    withClient(
      dbUrl,
      async (c) =>
        (
          await c.query(
            `SELECT sequence_no, event_type, payload_json FROM job_event
              WHERE job_id = $1 ORDER BY sequence_no`,
            [id],
          )
        ).rows,
    );

  const readGraph = async (situationId: string) =>
    withClient(dbUrl, async (c) => {
      const version = (
        await c.query(
          `SELECT v.sop_version_id, v.version_no, v.status, v.graph_hash, v.schema_version,
                  v.graph_violations, v.generation_job_id, v.adapter_id, v.generated_by_mock,
                  s.sop_id, s.title, s.status AS sop_status, s.current_version_id
             FROM sop s JOIN sop_version v ON v.sop_id = s.sop_id
            WHERE s.situation_id = $1
            ORDER BY v.version_no DESC LIMIT 1`,
          [situationId],
        )
      ).rows[0];
      if (!version) return null;
      const nodes = (
        await c.query(
          `SELECT node_key, node_type, title, sort_order, mapping_warnings, config_json
             FROM sop_node WHERE sop_version_id = $1 ORDER BY sort_order`,
          [version.sop_version_id],
        )
      ).rows;
      const edges = (
        await c.query(
          `SELECT f.node_key AS from_key, t.node_key AS to_key
             FROM sop_edge e
             JOIN sop_node f ON f.node_id = e.from_node_id
             JOIN sop_node t ON t.node_id = e.to_node_id
            WHERE e.sop_version_id = $1`,
          [version.sop_version_id],
        )
      ).rows;
      return { version, nodes, edges };
    });

  const runner = (scenarios = true): SopJobRunner =>
    new SopJobRunner(db, new MockUniSopAdapter({ scenariosEnabled: scenarios }), config);

  beforeAll(async () => {
    const adminUrl = new URL(ADMIN_URL as string);
    dbName = `cc240_${randomUUID().slice(0, 8)}`;
    await withClient(ADMIN_URL as string, (c) => c.query(`CREATE DATABASE ${dbName}`));
    adminUrl.pathname = `/${dbName}`;
    dbUrl = adminUrl.toString();
    await migrate({
      databaseUrl: dbUrl,
      dir: MIGRATIONS_DIR,
      migrationsTable: 'pgmigrations',
      ignorePattern: '\\..*|README\\.md',
      direction: 'up',
      logger: { info: () => {}, warn: () => {}, error: console.error, debug: () => {} },
    });
    config = loadWorkerConfig({ DATABASE_URL: dbUrl, UNE_DB_RUNTIME_ROLE: 'une_worker' });
    db = new WorkerDatabase(config);
  }, 180_000);

  afterAll(async () => {
    if (db) await db.close();
    if (dbName) {
      await withClient(ADMIN_URL as string, (c) => c.query(`DROP DATABASE IF EXISTS ${dbName}`));
    }
  });

  it('(1) UNI 스트림을 DRAFT 그래프로 옮긴다', async () => {
    const f = await seed('sop-ok');
    const summary = await runner().runOnce();
    expect(summary.completed).toBeGreaterThanOrEqual(1);

    const job = await readJob(f.jobId);
    expect(job.status).toBe('COMPLETED');
    expect(Number(job.progress_pct)).toBe(100);
    expect(job.finished_at).not.toBeNull();

    const graph = await readGraph(f.situationId);
    expect(graph).not.toBeNull();
    if (!graph) return;
    expect(graph.version.status).toBe('DRAFT');
    expect(graph.version.version_no).toBe(1);
    expect(graph.version.generation_job_id).toBe(f.jobId);
    // schema_version에는 **매퍼 버전**이 들어간다 (계약 '1.0'이 아니라).
    expect(graph.version.schema_version).toBe('uni-sop-2');
    expect(graph.version.graph_hash).toMatch(/^[0-9a-f]{64}$/);
    // **마지막 END는 UNI가 보낸 것이 아니다 (CC-410).** UNI는 마지막 노드에서
    // 나가는 간선을 남기면서 그 대상을 보내지 않는다 — 실 UNI 3표본 전부.
    // 세우지 않으면 NO_END와 DANGLING_EDGE가 함께 서서 승인이 막힌다.
    expect(graph.nodes.map((n) => n.node_type)).toEqual(['START', 'ACTION', 'ACTION', 'END']);
    expect(graph.edges).toHaveLength(3);
    expect(graph.version.graph_violations).toEqual([]);
    const synthesized = graph.nodes.find((n) => n.node_type === 'END');
    expect((synthesized?.mapping_warnings as string[]) ?? []).toContain('END_SYNTHESIZED');

    // 상황이 SOP_READY로 올라간다.
    const status = await withClient(
      dbUrl,
      async (c) =>
        (await c.query(`SELECT status FROM situation WHERE situation_id = $1`, [f.situationId]))
          .rows[0].status,
    );
    expect(status).toBe('SOP_READY');
  });

  it('(2) 원문 프레임과 화면용 투영이 함께 남는다', async () => {
    const f = await seed('sop-trace');
    await runner().runOnce();
    const events = await readEvents(f.jobId);
    const types = events.map((e) => e.event_type);

    expect(types).toContain('job.started');
    expect(types).toContain('provider.requested');
    expect(types).toContain('provider.responded');
    // **`sop.sources`가 서지 않는다 (CC-410).** 실 UNI의 `__sources__`에는
    // doc_id가 없어(`{filename, score, text}`뿐) 어느 문서인지 가리킬 수 없다.
    // 가리킬 수 없는 출처를 근거로 적으면 추적이 되는 것처럼 보인다.
    expect(types).not.toContain('sop.sources');
    // 3개는 UNI가 보낸 노드, 1개는 매달린 간선을 보고 UNE가 세운 END다.
    // **세운 노드도 투영에 넣는다** — 캔버스에 보이는 것이 그래프이고, 사용자는
    // 그 노드의 `END_SYNTHESIZED` 경고로 "UNI가 준 것이 아니다"를 안다.
    expect(types.filter((t) => t === 'sop.node')).toHaveLength(4);
    const endEvent = events
      .filter((e) => e.event_type === 'sop.node')
      .find((e) => (e.payload_json as { nodeType?: string }).nodeType === 'END');
    expect((endEvent?.payload_json as { warnings?: string[] }).warnings).toContain(
      'END_SYNTHESIZED',
    );
    expect(types[types.length - 1]).toBe('job.completed');

    const responded = events.find((e) => e.event_type === 'provider.responded');
    // 원문 프레임 전부가 남는다 — 매핑 결과만으로는 "UNI가 무엇을 보냈는가"에
    // 답할 수 없다(OB-04가 열려 있는 동안 특히).
    expect(Array.isArray(responded?.payload_json.rawResponse)).toBe(true);
    expect((responded?.payload_json.rawResponse as unknown[]).length).toBeGreaterThan(4);

    // 호출 의도에는 프롬프트 본문이 없다 — 상황 사실이 들어 있기 때문이다.
    const requested = events.find((e) => e.event_type === 'provider.requested');
    expect(JSON.stringify(requested?.payload_json)).not.toContain('침수');
    expect(requested?.payload_json.phase).toBe('intent');

    const node = events.find((e) => e.event_type === 'sop.node');
    // UNI 원문 키(`compnSn`)가 아니라 UNE 어휘로 나간다.
    expect(Object.keys(node?.payload_json as object).sort()).toEqual([
      'nodeKey',
      'nodeType',
      'taskCount',
      'title',
      'warnings',
    ]);
  });

  it('(3) 모르는 유형 코드가 와도 노드를 버리지 않고 알린다', async () => {
    // **CC-410에서 바뀐 시험이다.** `.sop-after-end.`(END 뒤 노드 → EDGE_FROM_END)는
    // 없어졌다 — 실 UNI는 END 노드를 아예 보내지 않으므로 그 시나리오를 만들 수
    // 없다. 대신 실제로 일어날 수 있는 것을 시험한다: UNI 유형 코드 표를 우리가
    // 받지 못했으므로(OB-13) 처음 보는 코드가 오는 것이 정상이다.
    const f = await seed('sop-viol', { prompt: '.sop-unknown-type. 상황' });
    const summary = await runner().runOnce();
    expect(summary.completed).toBe(1);

    const job = await readJob(f.jobId);
    expect(job.status).toBe('COMPLETED');

    const graph = await readGraph(f.situationId);
    // 거부하면 사용자는 그 절차가 있었다는 사실조차 모른다 — 세우고 알린다.
    expect(graph?.nodes).toHaveLength(5);
    const flagged = (graph?.nodes ?? []).filter((n) =>
      ((n.mapping_warnings as string[]) ?? []).includes('UNKNOWN_FIELD_DROPPED'),
    );
    expect(flagged.length).toBeGreaterThan(0);
  });

  it('(4) 깨진 노드 하나가 나머지를 죽이지 않는다', async () => {
    const f = await seed('sop-malf', { prompt: '.sop-malformed. 상황' });
    await runner().runOnce();

    const graph = await readGraph(f.situationId);
    expect(graph?.nodes.map((n) => n.node_type)).toEqual(['START', 'ACTION', 'ACTION', 'END']);

    const completed = (await readEvents(f.jobId)).find((e) => e.event_type === 'job.completed');
    // 거부 사실이 결과에 남는다 — 조용히 빠지면 "노드가 왜 3개인가"에 답할 수 없다.
    expect(completed?.payload_json.rejectedNodeCount).toBe(1);
  });

  it('(5) 재생성은 새 SOP가 아니라 새 버전이다', async () => {
    const f = await seed('sop-rev');
    await runner().runOnce();

    // 같은 상황에 두 번째 잡을 넣는다.
    const second = await withClient(
      dbUrl,
      async (c) =>
        (
          await c.query(
            `INSERT INTO generation_job
               (tenant_id, job_type, aggregate_type, aggregate_id, provider_code, request_json,
                status, progress_pct, idempotency_key, correlation_id)
             VALUES ($1,'SOP','SITUATION',$2,'UNI',$3::jsonb,'QUEUED',0,$4,'corr-rev2')
             RETURNING job_id`,
            [
              f.tenantId,
              f.situationId,
              JSON.stringify({
                snapshotId: f.snapshotId,
                evidenceSetId: f.evidenceSetId,
                graphSchemaVersion: '1.0',
                requestedBy: f.userId,
              }),
              `idem-rev2-${randomUUID().slice(0, 8)}`,
            ],
          )
        ).rows[0].job_id as string,
    );
    await runner().runOnce();
    expect((await readJob(second)).status).toBe('COMPLETED');

    const counts = await withClient(dbUrl, async (c) => ({
      sops: (
        await c.query(`SELECT count(*)::int n FROM sop WHERE situation_id = $1`, [f.situationId])
      ).rows[0].n,
      versions: (
        await c.query(
          `SELECT count(*)::int n FROM sop_version v JOIN sop s USING (sop_id)
            WHERE s.situation_id = $1`,
          [f.situationId],
        )
      ).rows[0].n,
    }));
    expect(counts).toEqual({ sops: 1, versions: 2 });
    expect((await readGraph(f.situationId))?.version.version_no).toBe(2);
  });

  it('(6) __done__ 없이 끊기면 FAILED이고 그래프는 생기지 않는다', async () => {
    const f = await seed('sop-trunc', { prompt: '.sop-truncated. 상황' });
    const summary = await runner().runOnce();
    expect(summary.failed).toBe(1);

    const job = await readJob(f.jobId);
    expect(job.status).toBe('FAILED');
    expect(job.error_json.code).toBe('UNI-503-003');
    expect(job.error_json.providerCode).toBe('UNI_SOP_UNTERMINATED');
    // 이미 받은 노드 수를 알려준다 — 폐기 여부는 사용자 결정이다(§1.11).
    expect(job.error_json.partialNodeCount).toBeGreaterThan(0);
    expect(await readGraph(f.situationId)).toBeNull();

    const events = await readEvents(f.jobId);
    // 실패해도 원문은 남는다.
    expect(events.map((e) => e.event_type)).toContain('provider.failed');
  });

  it('(7) UNI에 등록된 근거 문서가 없으면 부르지 않고 거절한다', async () => {
    const f = await seed('sop-nodoc', { registerDocument: false });
    const summary = await runner().runOnce();
    expect(summary.failed).toBe(1);

    const job = await readJob(f.jobId);
    expect(job.error_json.reason).toBe('NO_REGISTERED_EVIDENCE_DOCUMENT');
    // provider를 부르지 않았으므로 응답 이벤트가 없다.
    const types = (await readEvents(f.jobId)).map((e) => e.event_type);
    expect(types).not.toContain('provider.responded');
    expect(types).not.toContain('provider.failed');
  });

  it('(8) 동결되지 않은 근거집합으로는 만들지 않는다', async () => {
    // 동결을 **되돌리지** 않는다 — 0031 트리거가 그것을 막는다(그것이 옳다).
    // 처음부터 DRAFT인 집합으로 잡을 만든다.
    const f = await seed('sop-draft-ev', { freezeEvidence: false });
    await runner().runOnce();

    const job = await readJob(f.jobId);
    expect(job.status).toBe('FAILED');
    expect(job.error_json.reason).toBe('SOURCES_NOT_FOUND');
    expect(await readGraph(f.situationId)).toBeNull();
  });

  it('(9) 취소 요청된 잡은 결과를 반영하지 않는다', async () => {
    const f = await seed('sop-cancel');
    await withClient(dbUrl, (c) =>
      c.query(`UPDATE generation_job SET status = 'CANCEL_REQUESTED' WHERE job_id = $1`, [f.jobId]),
    );
    const summary = await runner().runOnce();
    expect(summary.cancelled).toBe(1);

    expect((await readJob(f.jobId)).status).toBe('CANCELLED');
    expect(await readGraph(f.situationId)).toBeNull();
  });

  it('(10) 노드 근거가 비어 있고, 비어 있다는 사실이 경고로 남는다', async () => {
    // **CC-410에서 뒤집힌 시험이다.** CC-240은 UNI가 노드마다 `source`를 준다고
    // 보고 "provider id가 새지 않는다"를 시험했다. 실 UNI는 노드에 출처를 아예
    // 붙이지 않고, 스트림 수준 `__sources__`에도 doc_id가 없다
    // (`{filename, score, text}`뿐). 그래서 이을 수 있는 근거가 하나도 없다.
    //
    // 매핑이 조용히 비는 것과 provider가 주지 않는 것은 다르다 — 후자는
    // 경고로 드러나야 한다.
    const f = await seed('sop-ids');
    await runner().runOnce();

    const graph = await readGraph(f.situationId);
    const refs = (graph?.nodes ?? []).flatMap(
      (n) => (n.config_json as { sourceRefs?: string[] }).sourceRefs ?? [],
    );
    expect(refs).toHaveLength(0);
    // provider id가 샐 자리 자체가 없다.
    expect(refs).not.toContain(f.providerDocumentId);

    const noSource = (graph?.nodes ?? []).filter((n) =>
      ((n.mapping_warnings as string[]) ?? []).includes('NO_SOURCE_REFS'),
    );
    expect(noSource.length).toBe((graph?.nodes ?? []).length - 1); // 세운 END는 제외

    // 가리킬 수 없는 출처로 `sop.sources`를 세우지 않는다.
    const sources = (await readEvents(f.jobId)).find((e) => e.event_type === 'sop.sources');
    expect(sources).toBeUndefined();
  });

  it('(11) 같은 키로 접히는 노드가 와도 저장된다 (트랜잭션이 죽지 않는다)', async () => {
    // `"3"`과 `"#3"`이 둘 다 `n3`로 정규화된다. 해소하지 않으면 유니크 제약이
    // 23505를 던져 트랜잭션 전체가 되돌아가고, 잡은 리스 만료 → 재클레임을
    // 반복하다 MAX_ATTEMPTS_EXCEEDED라는 엉뚱한 사유로 끝난다.
    const f = await seed('sop-dup', { prompt: '.sop-dup-key. 상황' });
    const summary = await runner().runOnce();
    expect(summary.completed).toBe(1);

    const graph = await readGraph(f.situationId);
    const keys = (graph?.nodes ?? []).map((n) => n.node_key as string);
    expect(new Set(keys).size).toBe(keys.length);
    // 두 노드 모두 살아남는다 — 하나를 버리면 절차가 달라진다.
    expect(keys.filter((k) => k.startsWith('n3'))).toHaveLength(2);
  });

  it('(12) 근거 범위 이탈을 검출할 수 없다는 사실을 고정한다', async () => {
    // **CC-410에서 뒤집힌 시험이다.** CC-240은 `doc_ids`로 범위를 지정하고
    // 응답 출처와 대조해 이탈을 잡았다. 실 UNI에는 **`doc_ids` 필드 자체가
    // 없고**(요청은 `{query, model_key?, top_k}`뿐) 노드에 출처도 없다.
    // 범위 이탈을 만들 수도, 검출할 수도 없다.
    //
    // 러너의 대조 코드는 남겨 둔다(UNI가 출처를 붙이면 그날 살아난다). 다만
    // **지금 그것이 아무것도 잡지 못한다는 사실**을 시험으로 고정해 둔다 —
    // 그러지 않으면 "범위 검사가 있다"는 인상만 남는다.
    const f = await seed('sop-scope');
    const summary = await runner().runOnce();
    expect(summary.completed).toBe(1);

    const graph = await readGraph(f.situationId);
    const flagged = (graph?.nodes ?? []).filter((n) =>
      ((n.mapping_warnings as string[]) ?? []).includes('SOURCE_OUT_OF_SCOPE'),
    );
    expect(flagged).toHaveLength(0);

    const completed = (await readEvents(f.jobId)).find((e) => e.event_type === 'job.completed');
    expect(completed?.payload_json.outOfScopeNodeCount).toBe(0);
  });

  it('(13) 어느 어댑터가 만들었는지 버전 행에 남는다', async () => {
    const f = await seed('sop-prov');
    await runner().runOnce();

    const graph = await readGraph(f.situationId);
    // mock 산출물과 실 UNI 산출물이 데이터 층에서 구분돼야 한다 — 그러지
    // 않으면 저장된 버전만 보고 "UNI가 만들었다"고 오해할 수 있다.
    expect(graph?.version.adapter_id).toBe('mock-uni-sop');
    expect(graph?.version.generated_by_mock).toBe(true);
    // SOP가 새 버전을 가리킨다.
    expect(graph?.version.current_version_id).toBe(graph?.version.sop_version_id);
  });

  it('(14) 워커는 기존 버전을 수정할 수 없다 (0034)', async () => {
    const f = await seed('sop-immutable');
    await runner().runOnce();
    const graph = await readGraph(f.situationId);

    const code = await withClient(dbUrl, async (c) => {
      await c.query(`SET ROLE une_worker`);
      await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [f.tenantId]);
      try {
        await c.query(`UPDATE sop_version SET graph_hash = $2 WHERE sop_version_id = $1`, [
          graph?.version.sop_version_id,
          'f'.repeat(64),
        ]);
        return 'NO_ERROR';
      } catch (err) {
        return (err as { code?: string }).code ?? 'UNKNOWN';
      }
    });
    // 수정 경로가 없는데 권한이 있으면 그것이 곧 구멍이다.
    expect(code).toBe('42501');
  });
});
