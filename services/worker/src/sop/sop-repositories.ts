import type { PoolClient } from 'pg';
import type { SopEdgeDraft, SopNodeDraft } from '@une/domain';

/**
 * SOP 생성 잡이 쓰는 SQL (CC-240).
 *
 * 워커 권한은 `sop`/`sop_node`/`sop_edge`에 SELECT·INSERT, `sop_version`에도
 * SELECT·INSERT뿐이다(0032 §5가 준 테이블 단위 UPDATE는 **쓰는 코드가 없어**
 * 0034가 회수했다 — 그 권한으로는 기존 버전의 `graph_hash`·출처를 감사 기록
 * 없이 갈아치울 수 있었다). 포인터 이동만 `sop.current_version_id` 열 권한이다.
 *
 * DELETE는 어디에도 없으므로 "실패하면 지운다"가 아니라 "실패하면 트랜잭션을
 * 되돌린다"가 유일한 정리 방법이다.
 */

export interface SopSourceRefs {
  snapshotId: string;
  evidenceSetId: string;
  /** 상황 제목 — 생성되는 SOP 이름의 근거다. */
  situationTitle: string;
  hazardType: string;
  factsJson: unknown;
  snapshotHash: string;
  evidenceQuery: string;
}

/**
 * 잡이 근거로 삼는 것들을 한 번에 읽고 **동시에 검증한다.**
 *
 * 조인으로 묶는 이유: 스냅샷과 근거집합이 각각 존재하는 것으로는 부족하고
 * **같은 상황의 것**이어야 한다. 따로 읽어 비교하면 그 사이에 규칙이 새는
 * 코드가 하나 더 생긴다.
 *
 * `evidence_set.status = 'FROZEN'`을 조건에 넣는다 — 움직이는 근거 위에서
 * 만든 SOP는 재현되지 않는다(0031이 동결을 불변으로 만든 이유와 같다).
 */
export async function findSopSources(
  client: PoolClient,
  tenantId: string,
  situationId: string,
  snapshotId: string,
  evidenceSetId: string,
): Promise<SopSourceRefs | null> {
  const result = await client.query(
    `SELECT sn.snapshot_id, sn.facts_json, sn.content_hash,
            es.evidence_set_id, es.query_text,
            s.title AS situation_title, s.hazard_type
     FROM situation s
     JOIN situation_snapshot sn ON sn.situation_id = s.situation_id AND sn.snapshot_id = $3
     JOIN evidence_set es ON es.situation_id = s.situation_id
                         AND es.evidence_set_id = $4
                         AND es.snapshot_id = sn.snapshot_id
                         AND es.status = 'FROZEN'
     WHERE s.situation_id = $2 AND s.tenant_id = $1`,
    [tenantId, situationId, snapshotId, evidenceSetId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    snapshotId: row.snapshot_id as string,
    evidenceSetId: row.evidence_set_id as string,
    situationTitle: row.situation_title as string,
    hazardType: row.hazard_type as string,
    factsJson: row.facts_json,
    snapshotHash: row.content_hash as string,
    evidenceQuery: row.query_text as string,
  };
}

/**
 * 동결 근거가 가리키는 문서 — 생성 범위이자 **id 공간 사이의 다리**.
 *
 * `evidence_item`은 UNE 문서 id를 들고 있고 UNI가 아는 것은
 * `knowledge_document.provider_document_id`다. 요청에는 provider id를 보내야
 * 하지만 **저장과 화면에는 UNE id를 써야 한다** — provider id를 그대로 남기면
 * 클라이언트가 `knowledge_document`와 대조할 수 없고, UNI가 id 체계를 바꾸면
 * 저장된 그래프의 근거 참조가 통째로 끊긴다(CC-230이 `evidence_item`에서
 * 둘을 분리한 것과 같은 이유). 그래서 **양방향을 함께** 돌려준다.
 *
 * `REGISTERED`가 아닌 문서는 빠진다 — UNI에 없는 id를 범위로 주면 provider가
 * 무엇을 하든 우리가 예측할 수 없다.
 */
export interface EvidenceScope {
  /** UNI에 보낼 문서 범위. */
  providerDocumentIds: string[];
  /** provider id → UNE `knowledge_document_id`. */
  toKnowledgeDocumentId: Map<string, string>;
}

export async function findEvidenceScope(
  client: PoolClient,
  evidenceSetId: string,
): Promise<EvidenceScope> {
  const result = await client.query(
    `SELECT DISTINCT kd.provider_document_id, kd.knowledge_document_id
       FROM evidence_item ei
       JOIN knowledge_document kd ON kd.knowledge_document_id = ei.knowledge_document_id
      WHERE ei.evidence_set_id = $1
        AND kd.status = 'REGISTERED'
        AND kd.provider_document_id IS NOT NULL
      ORDER BY kd.provider_document_id`,
    [evidenceSetId],
  );
  const toKnowledgeDocumentId = new Map<string, string>();
  for (const row of result.rows) {
    toKnowledgeDocumentId.set(
      row.provider_document_id as string,
      row.knowledge_document_id as string,
    );
  }
  return {
    providerDocumentIds: [...toKnowledgeDocumentId.keys()],
    toKnowledgeDocumentId,
  };
}

/**
 * 이 상황의 SOP 컨테이너를 찾거나 만든다.
 *
 * 재생성은 **새 SOP가 아니라 새 버전**이다. 근거가 늘어 다시 만들 때마다 SOP가
 * 하나씩 생기면 "이 상황의 절차"가 무엇인지 말할 수 없다.
 */
export async function ensureSop(
  client: PoolClient,
  input: {
    tenantId: string;
    situationId: string;
    title: string;
    hazardType: string;
    createdBy: string;
  },
): Promise<string> {
  // **행 잠금을 걸지 않는다.** `SELECT ... FOR UPDATE`는 테이블 단위 UPDATE
  // 권한을 요구하는데(열 단위 GRANT로는 부족하다) 워커에 `sop` 전체 UPDATE를
  // 주면 제목·재난유형까지 바꿀 수 있게 된다 — 0030에서 정한 선을 넘는다.
  //
  // 잠금 없이도 안전한 이유: 한 상황에 활성 SOP 생성 잡은 하나뿐이다
  // (API `findActiveSopJob`). 그 가드가 뚫려 둘이 동시에 끝나도 최악은 SOP가
  // 둘 생기는 것이고, 데이터가 깨지지는 않는다. 반대로 `sop`에 유니크 제약을
  // 거는 선택지는 버렸다 — UNE-SOP-003이 한 상황에 여러 SOP를 만들 수 있다.
  const existing = await client.query(
    `SELECT sop_id FROM sop
      WHERE tenant_id = $1 AND situation_id = $2
      ORDER BY created_at
      LIMIT 1`,
    [input.tenantId, input.situationId],
  );
  if (existing.rows[0]) return existing.rows[0].sop_id as string;

  const inserted = await client.query(
    `INSERT INTO sop (tenant_id, situation_id, title, hazard_type, status, created_by)
     VALUES ($1, $2, $3, $4, 'DRAFT', $5)
     RETURNING sop_id`,
    [input.tenantId, input.situationId, input.title, input.hazardType, input.createdBy],
  );
  return inserted.rows[0].sop_id as string;
}

export async function nextSopVersionNo(client: PoolClient, sopId: string): Promise<number> {
  const result = await client.query(
    `SELECT coalesce(max(version_no), 0) + 1 AS next FROM sop_version WHERE sop_id = $1`,
    [sopId],
  );
  return Number(result.rows[0].next);
}

export async function insertSopVersion(
  client: PoolClient,
  input: {
    sopId: string;
    versionNo: number;
    graphHash: string;
    /** UniSopMapper 버전. 계약의 graphSchemaVersion과 다른 것이다. */
    mapperVersion: string;
    snapshotId: string;
    evidenceSetId: string;
    generationJobId: string;
    violations: string[];
    createdBy: string;
    /** 어느 어댑터가 만들었는가. mock 산출물을 데이터 층에서 구분한다. */
    adapterId: string;
    generatedByMock: boolean;
  },
): Promise<string> {
  const result = await client.query(
    `INSERT INTO sop_version
       (sop_id, version_no, status, graph_hash, source_snapshot_id, source_evidence_set_id,
        schema_version, graph_violations, generation_job_id, created_by,
        adapter_id, generated_by_mock)
     VALUES ($1, $2, 'DRAFT', $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING sop_version_id`,
    [
      input.sopId,
      input.versionNo,
      input.graphHash,
      input.snapshotId,
      input.evidenceSetId,
      input.mapperVersion,
      JSON.stringify(input.violations),
      input.generationJobId,
      input.createdBy,
      input.adapterId,
      input.generatedByMock,
    ],
  );
  return result.rows[0].sop_version_id as string;
}

/**
 * 노드와 간선을 적재하고 `nodeKey -> node_id`를 돌려준다.
 *
 * 간선은 노드 **키**로 오고 DB는 **id**로 잇는다. 그 변환을 여기 한곳에 두어야
 * 간선이 엉뚱한 노드를 가리키는 경로가 생기지 않는다.
 */
export async function insertSopGraph(
  client: PoolClient,
  sopVersionId: string,
  nodes: Array<SopNodeDraft & { warnings: string[] }>,
  edges: SopEdgeDraft[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  let sortOrder = 0;
  for (const node of nodes) {
    sortOrder += 1;
    const result = await client.query(
      `INSERT INTO sop_node
         (sop_version_id, node_key, node_type, title, config_json, sort_order, mapping_warnings)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING node_id`,
      [
        sopVersionId,
        node.nodeKey,
        node.type,
        node.title,
        JSON.stringify({
          // UNI가 준 원래 키. 정규화했으면 여기서만 확인할 수 있다.
          providerNodeKey: node.providerNodeKey,
          tasks: node.tasks,
          decisionExpression: node.decisionExpression,
          sourceRefs: node.sourceRefs,
        }),
        sortOrder,
        JSON.stringify(node.warnings),
      ],
    );
    ids.set(node.nodeKey, result.rows[0].node_id as string);
  }

  for (const edge of edges) {
    const from = ids.get(edge.fromNodeKey);
    const to = ids.get(edge.toNodeKey);
    // 노드를 찾지 못한 간선은 버리지 않고 던진다 — 조용히 빠지면 그래프가
    // 끊긴 채로 저장되고, 검증 결과(DANGLING_EDGE)와 실제 저장 내용이 달라진다.
    if (!from || !to) {
      throw new Error(
        `간선이 존재하지 않는 노드를 가리킵니다: ${edge.fromNodeKey}->${edge.toNodeKey}`,
      );
    }
    await client.query(
      `INSERT INTO sop_edge (sop_version_id, from_node_id, to_node_id, condition_expr, priority, label)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sopVersionId, from, to, edge.conditionExpr, edge.priority, edge.label],
    );
  }
  return ids;
}

/** 상황 상태를 SOP_READY로 올린다. 이미 그 이후 상태면 손대지 않는다. */
export async function markSituationSopReady(
  client: PoolClient,
  tenantId: string,
  situationId: string,
): Promise<void> {
  await client.query(
    `UPDATE situation SET status = 'SOP_READY'
      WHERE situation_id = $1 AND tenant_id = $2 AND status = 'CONTEXT_CONFIRMED'`,
    [situationId, tenantId],
  );
}

/**
 * SOP가 가리키는 현재 버전을 새 버전으로 옮긴다.
 *
 * 이것을 하지 않으면 그래프는 저장돼 있는데 `sop.current_version_id`가 비어
 * 있어, "이 SOP의 절차"를 물었을 때 답할 것이 없다. CC-250의 승인이 오면
 * "현재"의 뜻이 달라지겠지만(승인본), 지금은 최신 DRAFT가 유일한 후보다.
 */
export async function pointSopAtVersion(
  client: PoolClient,
  sopId: string,
  sopVersionId: string,
): Promise<void> {
  await client.query(`UPDATE sop SET current_version_id = $2 WHERE sop_id = $1`, [
    sopId,
    sopVersionId,
  ]);
}
