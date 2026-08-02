import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { ChangeOperation, DocumentIR, TemplateProfile } from '@une/domain';

/**
 * 문서 편집 표면의 유일한 SQL 경계 (CC-150).
 *
 * 0018이 문서 계열 여덟 테이블에 RLS를 걸었으므로 **격리는 정책이 보장한다.**
 * 이 파일이 더하는 보상통제는 그 위의 한 겹이다(ADR-21):
 *
 *   - `document` 자체를 읽는 질의는 `tenant_id` 술어를 직접 건다.
 *   - 하위 테이블 질의는 전부 `document_id`(또는 `change_set_id` + 그 문서를
 *     확인하는 EXISTS)를 술어로 갖는다. 즉 **문서를 특정하지 않은 하위 질의는
 *     없다** — 부모는 이미 테넌트 범위에서 잠긴 뒤다.
 *
 * 편집 표면의 SQL은 여기 말고 어디에도 두지 않는다. 서비스가 직접 질의를 쓰면
 * 이 규칙이 한 곳에서만 깨지고, 그 한 곳이 정책 변경 때 유일한 구멍이 된다.
 */

export interface DocumentRow {
  documentId: string;
  tenantId: string;
  documentType: string;
  title: string;
  sourceFileId: string | null;
  currentRevisionId: string | null;
  status: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RevisionRow {
  revisionId: string;
  documentId: string;
  revisionNo: number;
  parentRevisionId: string | null;
  irJson: DocumentIR;
  irHash: string;
  changeSummary: string | null;
  origin: string;
  checkpointLabel: string | null;
  createdBy: string;
  createdAt: Date;
}

/** 목록(UNE-DOC-007)은 본문(ir_json)을 싣지 않는다: 페이지당 수 MB가 되고,
 * 버전이력 화면은 작성자·시각·요약·라벨만 쓴다(US-PLAN-020 정상흐름 #3). */
export type RevisionSummaryRow = Omit<RevisionRow, 'irJson'>;

export interface ChangeSetRow {
  changeSetId: string;
  documentId: string;
  baseRevisionId: string;
  resultRevisionId: string | null;
  clientMutationId: string;
  selectionJson: Record<string, unknown>;
  status: string;
  origin: string;
  undoesChangeSetId: string | null;
  createdBy: string;
  createdAt: Date;
}

export interface AutosaveRow {
  autosaveId: string;
  documentId: string;
  baseRevisionId: string;
  clientMutationId: string;
  seq: string;
  deltaJson: Record<string, unknown>;
  resultRevisionId: string | null;
  status: string;
  createdBy: string;
  createdAt: Date;
}

export interface GeneratedBlockRow {
  blockId: string;
  nodeKey: string;
  outlineLevel: number;
  sortOrder: number;
  title: string;
  textContent: string;
  protectionState: string;
  status: string;
}

export interface InsertRevisionInput {
  documentId: string;
  revisionNo: number;
  parentRevisionId: string | null;
  ir: DocumentIR;
  irHash: string;
  changeSummary: string | null;
  origin: string;
  checkpointLabel: string | null;
  createdBy: string;
}

export interface InsertChangeSetInput {
  documentId: string;
  baseRevisionId: string;
  clientMutationId: string;
  selectionJson: Record<string, unknown>;
  status: 'APPLIED' | 'REJECTED';
  origin: string;
  undoesChangeSetId: string | null;
  createdBy: string;
  /** 신규 노드 ID의 결정적 좌표(ADR-30 D2)라서 엔진 호출 전에 발급된다.
   * DEFAULT gen_random_uuid()에 맡기면 ID를 알기 전에 엔진을 부를 수 없다. */
  changeSetId?: string;
}

const REVISION_COLUMNS = `revision_id, document_id, revision_no, parent_revision_id,
  ir_hash, change_summary, origin, checkpoint_label, created_by, created_at`;

function toRevisionSummary(row: Record<string, unknown>): RevisionSummaryRow {
  return {
    revisionId: row.revision_id as string,
    documentId: row.document_id as string,
    revisionNo: row.revision_no as number,
    parentRevisionId: (row.parent_revision_id as string | null) ?? null,
    irHash: (row.ir_hash as string).trim(),
    changeSummary: (row.change_summary as string | null) ?? null,
    origin: row.origin as string,
    checkpointLabel: (row.checkpoint_label as string | null) ?? null,
    createdBy: row.created_by as string,
    createdAt: row.created_at as Date,
  };
}

function toRevision(row: Record<string, unknown>): RevisionRow {
  return { ...toRevisionSummary(row), irJson: row.ir_json as DocumentIR };
}

function toChangeSet(row: Record<string, unknown>): ChangeSetRow {
  return {
    changeSetId: row.change_set_id as string,
    documentId: row.document_id as string,
    baseRevisionId: row.base_revision_id as string,
    resultRevisionId: (row.result_revision_id as string | null) ?? null,
    clientMutationId: row.client_mutation_id as string,
    selectionJson: (row.selection_json as Record<string, unknown>) ?? {},
    status: row.status as string,
    origin: row.origin as string,
    undoesChangeSetId: (row.undoes_change_set_id as string | null) ?? null,
    createdBy: row.created_by as string,
    createdAt: row.created_at as Date,
  };
}

function toAutosave(row: Record<string, unknown>): AutosaveRow {
  return {
    autosaveId: row.autosave_id as string,
    documentId: row.document_id as string,
    baseRevisionId: row.base_revision_id as string,
    clientMutationId: row.client_mutation_id as string,
    // bigint는 pg가 문자열로 준다(정밀도 보존). 계약에서도 문자열로 나간다.
    seq: String(row.seq),
    deltaJson: (row.delta_json as Record<string, unknown>) ?? {},
    resultRevisionId: (row.result_revision_id as string | null) ?? null,
    status: row.status as string,
    createdBy: row.created_by as string,
    createdAt: row.created_at as Date,
  };
}

@Injectable()
export class DocumentRepository {
  // ── document ────────────────────────────────────────────────────────────

  /**
   * `forUpdate`는 편집 경로의 **직렬화 지점**이다. 같은 문서에 대한 두 요청이
   * 동시에 head를 읽고 각자 revision_no+1을 계산하는 것을 막는다. 잠금 대상이
   * document 행 하나뿐이므로 잠금 순서 사이클이 생길 수 없다(문서 편집 경로는
   * 다른 애그리거트를 잠그지 않는다 — materialize의 plan 조회도 FOR UPDATE가
   * 아니다).
   */
  async findDocument(
    client: PoolClient,
    tenantId: string,
    documentId: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<DocumentRow | null> {
    const res = await client.query(
      `SELECT document_id, tenant_id, document_type, title, source_file_id,
              current_revision_id, status, owner_id, created_at, updated_at
       FROM document WHERE document_id = $1 AND tenant_id = $2
       ${options.forUpdate ? 'FOR UPDATE' : ''}`,
      [documentId, tenantId],
    );
    const row = res.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      documentId: row.document_id as string,
      tenantId: row.tenant_id as string,
      documentType: row.document_type as string,
      title: row.title as string,
      sourceFileId: (row.source_file_id as string | null) ?? null,
      currentRevisionId: (row.current_revision_id as string | null) ?? null,
      status: row.status as string,
      ownerId: row.owner_id as string,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    };
  }

  async insertDocument(
    client: PoolClient,
    input: {
      tenantId: string;
      documentType: string;
      title: string;
      sourceFileId: string | null;
      status: string;
      ownerId: string;
    },
  ): Promise<DocumentRow> {
    const res = await client.query(
      `INSERT INTO document (tenant_id, document_type, title, source_file_id, status, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING document_id, tenant_id, document_type, title, source_file_id,
                 current_revision_id, status, owner_id, created_at, updated_at`,
      [
        input.tenantId,
        input.documentType,
        input.title,
        input.sourceFileId,
        input.status,
        input.ownerId,
      ],
    );
    const row = res.rows[0] as Record<string, unknown>;
    return {
      documentId: row.document_id as string,
      tenantId: row.tenant_id as string,
      documentType: row.document_type as string,
      title: row.title as string,
      sourceFileId: (row.source_file_id as string | null) ?? null,
      currentRevisionId: (row.current_revision_id as string | null) ?? null,
      status: row.status as string,
      ownerId: row.owner_id as string,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    };
  }

  /** head 포인터 이동. 과거 revision은 건드리지 않는다. */
  async setCurrentRevision(
    client: PoolClient,
    tenantId: string,
    documentId: string,
    revisionId: string,
  ): Promise<void> {
    await client.query(
      `UPDATE document SET current_revision_id = $3, updated_at = now()
       WHERE document_id = $1 AND tenant_id = $2`,
      [documentId, tenantId, revisionId],
    );
  }

  // ── document_revision ───────────────────────────────────────────────────

  /**
   * head revision. `document.current_revision_id`를 우선 쓰고, 없으면
   * `MAX(revision_no)`로 되돌아간다 — 포인터는 편의이고 진실은 순번이다
   * (uk_document_revision_no가 그 순번의 유일성을 보장한다).
   */
  async findHeadRevision(
    client: PoolClient,
    documentId: string,
    options: { withIr?: boolean } = {},
  ): Promise<RevisionRow | RevisionSummaryRow | null> {
    const cols = options.withIr ? `${REVISION_COLUMNS}, ir_json` : REVISION_COLUMNS;
    const res = await client.query(
      `SELECT ${cols} FROM document_revision
       WHERE document_id = $1 ORDER BY revision_no DESC LIMIT 1`,
      [documentId],
    );
    const row = res.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return options.withIr ? toRevision(row) : toRevisionSummary(row);
  }

  async findRevision(
    client: PoolClient,
    documentId: string,
    revisionId: string,
    options: { withIr?: boolean } = {},
  ): Promise<RevisionRow | RevisionSummaryRow | null> {
    const cols = options.withIr ? `${REVISION_COLUMNS}, ir_json` : REVISION_COLUMNS;
    const res = await client.query(
      `SELECT ${cols} FROM document_revision WHERE revision_id = $1 AND document_id = $2`,
      [revisionId, documentId],
    );
    const row = res.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return options.withIr ? toRevision(row) : toRevisionSummary(row);
  }

  async listRevisions(
    client: PoolClient,
    documentId: string,
    page: number,
    size: number,
  ): Promise<{ items: RevisionSummaryRow[]; totalElements: number }> {
    const res = await client.query(
      `SELECT ${REVISION_COLUMNS}, count(*) OVER () AS total_count
       FROM document_revision WHERE document_id = $1
       ORDER BY revision_no DESC LIMIT $2 OFFSET $3`,
      [documentId, size, (page - 1) * size],
    );
    const rows = res.rows as Record<string, unknown>[];
    if (rows.length === 0) {
      const count = await client.query(
        `SELECT count(*)::int AS n FROM document_revision WHERE document_id = $1`,
        [documentId],
      );
      return { items: [], totalElements: (count.rows[0] as { n: number }).n };
    }
    return {
      items: rows.map(toRevisionSummary),
      totalElements: Number(rows[0].total_count),
    };
  }

  async insertRevision(client: PoolClient, input: InsertRevisionInput): Promise<RevisionRow> {
    const res = await client.query(
      `INSERT INTO document_revision
         (document_id, revision_no, parent_revision_id, ir_json, ir_hash,
          change_summary, origin, checkpoint_label, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${REVISION_COLUMNS}`,
      [
        input.documentId,
        input.revisionNo,
        input.parentRevisionId,
        JSON.stringify(input.ir),
        input.irHash,
        input.changeSummary,
        input.origin,
        input.checkpointLabel,
        input.createdBy,
      ],
    );
    return { ...toRevisionSummary(res.rows[0] as Record<string, unknown>), irJson: input.ir };
  }

  // ── change_set / change_operation ───────────────────────────────────────

  async insertChangeSet(client: PoolClient, input: InsertChangeSetInput): Promise<ChangeSetRow> {
    const res = await client.query(
      `INSERT INTO change_set
         (change_set_id, document_id, base_revision_id, client_mutation_id, selection_json,
          status, origin, undoes_change_set_id, created_by)
       VALUES (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING change_set_id, document_id, base_revision_id, result_revision_id,
                 client_mutation_id, selection_json, status, origin,
                 undoes_change_set_id, created_by, created_at`,
      [
        input.changeSetId ?? null,
        input.documentId,
        input.baseRevisionId,
        input.clientMutationId,
        JSON.stringify(input.selectionJson),
        input.status,
        input.origin,
        input.undoesChangeSetId,
        input.createdBy,
      ],
    );
    return toChangeSet(res.rows[0] as Record<string, unknown>);
  }

  async setChangeSetResult(
    client: PoolClient,
    changeSetId: string,
    resultRevisionId: string,
    documentId: string,
  ): Promise<void> {
    await client.query(
      `UPDATE change_set SET result_revision_id = $2
       WHERE change_set_id = $1 AND document_id = $3`,
      [changeSetId, resultRevisionId, documentId],
    );
  }

  async findChangeSet(
    client: PoolClient,
    documentId: string,
    changeSetId: string,
  ): Promise<ChangeSetRow | null> {
    const res = await client.query(
      `SELECT change_set_id, document_id, base_revision_id, result_revision_id,
              client_mutation_id, selection_json, status, origin,
              undoes_change_set_id, created_by, created_at
       FROM change_set WHERE document_id = $1 AND change_set_id = $2`,
      [documentId, changeSetId],
    );
    const row = res.rows[0] as Record<string, unknown> | undefined;
    return row ? toChangeSet(row) : null;
  }

  /**
   * 적용된 ChangeSet의 `selection_json`을 시간순으로. alias 이력(§1.8-2)과
   * UNDO_CONFLICT 판정(ADR-30 D7)이 같은 계보를 읽으므로 한 메서드로 둔다.
   *
   * `afterChangeSetId`를 주면 그 ChangeSet **이후**만 돌려준다. 동시각 삽입이
   * 있을 수 있어 `(created_at, change_set_id)` 사전식 비교로 자르되, 기준값은
   * **SQL 안에서** 읽는다: `timestamptz`는 마이크로초인데 JS `Date`는
   * 밀리초여서, 애플리케이션을 왕복시키면 값이 잘려 **자기 자신이 "이후"로
   * 잡힌다**(Undo가 항상 UNDO_CONFLICT가 된다).
   */
  async listAppliedChangeSets(
    client: PoolClient,
    documentId: string,
    afterChangeSetId?: string,
  ): Promise<
    {
      changeSetId: string;
      undoesChangeSetId: string | null;
      selectionJson: Record<string, unknown>;
    }[]
  > {
    const params: unknown[] = [documentId];
    let predicate = '';
    if (afterChangeSetId) {
      params.push(afterChangeSetId);
      predicate = ` AND (created_at, change_set_id) >
             (SELECT created_at, change_set_id FROM change_set
               WHERE change_set_id = $2 AND document_id = $1)`;
    }
    const res = await client.query(
      `SELECT change_set_id, undoes_change_set_id, selection_json
       FROM change_set
       WHERE document_id = $1 AND status = 'APPLIED'${predicate}
       ORDER BY created_at, change_set_id`,
      params,
    );
    return (
      res.rows as {
        change_set_id: string;
        undoes_change_set_id: string | null;
        selection_json: Record<string, unknown>;
      }[]
    ).map((row) => ({
      changeSetId: row.change_set_id,
      undoesChangeSetId: row.undoes_change_set_id,
      selectionJson: row.selection_json,
    }));
  }

  async findChangeSetByMutationId(
    client: PoolClient,
    documentId: string,
    clientMutationId: string,
  ): Promise<ChangeSetRow | null> {
    const res = await client.query(
      `SELECT change_set_id, document_id, base_revision_id, result_revision_id,
              client_mutation_id, selection_json, status, origin,
              undoes_change_set_id, created_by, created_at
       FROM change_set WHERE document_id = $1 AND client_mutation_id = $2`,
      [documentId, clientMutationId],
    );
    const row = res.rows[0] as Record<string, unknown> | undefined;
    return row ? toChangeSet(row) : null;
  }

  /**
   * 연산 행. `before_json`/`after_json`은 **문서 본문 조각**이다 — 이 값이
   * 로그로 새지 않게 하는 것이 backend.md의 "문서 본문을 INFO 로그에 남기지
   * 않는다"이며, 그래서 이 메서드는 값을 반환하지도 기록하지도 않는다.
   */
  async insertOperations(
    client: PoolClient,
    changeSetId: string,
    operations: readonly {
      order: number;
      type: string;
      target: Record<string, unknown>;
      before: unknown;
      after: unknown;
    }[],
  ): Promise<number> {
    for (const op of operations) {
      await client.query(
        `INSERT INTO change_operation
           (change_set_id, operation_order, operation_type, target_json, before_json, after_json)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          changeSetId,
          op.order,
          op.type,
          JSON.stringify(op.target),
          op.before === undefined ? null : JSON.stringify(op.before),
          op.after === undefined ? null : JSON.stringify(op.after),
        ],
      );
    }
    return operations.length;
  }

  /** Undo가 데이터 조회로 끝나도록 저장한 역연산을 되읽는다(ADR-30 D6). */
  async findInverseOperations(
    client: PoolClient,
    changeSetId: string,
    documentId: string,
  ): Promise<ChangeOperation[]> {
    const res = await client.query(
      `SELECT o.after_json FROM change_operation o
        WHERE o.change_set_id = $1
          AND EXISTS (SELECT 1 FROM change_set s
                       WHERE s.change_set_id = o.change_set_id AND s.document_id = $2)
        ORDER BY o.operation_order`,
      [changeSetId, documentId],
    );
    return (res.rows as { after_json: { inverse?: ChangeOperation[] } | null }[])
      .flatMap((row) => row.after_json?.inverse ?? [])
      .filter((op): op is ChangeOperation => op !== undefined);
  }

  // ── document_autosave ───────────────────────────────────────────────────

  async insertAutosave(
    client: PoolClient,
    input: {
      documentId: string;
      baseRevisionId: string;
      clientMutationId: string;
      seq: number;
      delta: Record<string, unknown>;
      resultRevisionId: string | null;
      status: 'ACCEPTED' | 'CONFLICT' | 'SUPERSEDED';
      createdBy: string;
    },
  ): Promise<AutosaveRow> {
    const res = await client.query(
      `INSERT INTO document_autosave
         (document_id, base_revision_id, client_mutation_id, seq, delta_json,
          result_revision_id, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING autosave_id, document_id, base_revision_id, client_mutation_id, seq,
                 delta_json, result_revision_id, status, created_by, created_at`,
      [
        input.documentId,
        input.baseRevisionId,
        input.clientMutationId,
        input.seq,
        JSON.stringify(input.delta),
        input.resultRevisionId,
        input.status,
        input.createdBy,
      ],
    );
    return toAutosave(res.rows[0] as Record<string, unknown>);
  }

  async findAutosaveByMutationId(
    client: PoolClient,
    documentId: string,
    clientMutationId: string,
  ): Promise<AutosaveRow | null> {
    const res = await client.query(
      `SELECT autosave_id, document_id, base_revision_id, client_mutation_id, seq,
              delta_json, result_revision_id, status, created_by, created_at
       FROM document_autosave WHERE document_id = $1 AND client_mutation_id = $2`,
      [documentId, clientMutationId],
    );
    const row = res.rows[0] as Record<string, unknown> | undefined;
    return row ? toAutosave(row) : null;
  }

  /** 이미 반영된 더 나중 순번이 있는가(US-PLAN-020 A-01 재동기화 경로). */
  async maxAcceptedAutosaveSeq(client: PoolClient, documentId: string): Promise<number | null> {
    const res = await client.query(
      `SELECT max(seq) AS max_seq FROM document_autosave
       WHERE document_id = $1 AND status = 'ACCEPTED'`,
      [documentId],
    );
    const value = (res.rows[0] as { max_seq: string | null }).max_seq;
    return value === null ? null : Number(value);
  }

  async nextAutosaveSeq(client: PoolClient, documentId: string): Promise<number> {
    const res = await client.query(
      `SELECT coalesce(max(seq), 0) + 1 AS next FROM document_autosave WHERE document_id = $1`,
      [documentId],
    );
    return Number((res.rows[0] as { next: string }).next);
  }

  // ── template_profile / style_prototype ──────────────────────────────────

  async findTemplateProfile(
    client: PoolClient,
    documentId: string,
  ): Promise<{ templateProfileId: string; profile: TemplateProfile } | null> {
    const res = await client.query(
      `SELECT template_profile_id, profile_json FROM template_profile
       WHERE document_id = $1 ORDER BY profile_version DESC LIMIT 1`,
      [documentId],
    );
    const row = res.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      templateProfileId: row.template_profile_id as string,
      profile: row.profile_json as TemplateProfile,
    };
  }

  async insertTemplateProfile(
    client: PoolClient,
    input: {
      documentId: string;
      profileVersion: number;
      analysisStatus: string;
      profile: TemplateProfile;
      unsupportedObjects: unknown;
      analysisHash: string;
    },
  ): Promise<string> {
    const res = await client.query(
      `INSERT INTO template_profile
         (document_id, profile_version, analysis_status, profile_json,
          unsupported_objects_json, analysis_hash)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING template_profile_id`,
      [
        input.documentId,
        input.profileVersion,
        input.analysisStatus,
        JSON.stringify(input.profile),
        JSON.stringify(input.unsupportedObjects),
        input.analysisHash,
      ],
    );
    return (res.rows[0] as { template_profile_id: string }).template_profile_id;
  }

  async insertStylePrototype(
    client: PoolClient,
    input: {
      templateProfileId: string;
      prototypeKey: string;
      prototypeType: string;
      sourceLocator: unknown;
      clonePolicy: unknown;
      styleFingerprint: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO style_prototype
         (template_profile_id, prototype_key, prototype_type,
          source_locator_json, clone_policy_json, style_fingerprint)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.templateProfileId,
        input.prototypeKey,
        input.prototypeType,
        JSON.stringify(input.sourceLocator),
        JSON.stringify(input.clonePolicy),
        input.styleFingerprint,
      ],
    );
  }

  // ── materialize 지원 (generated_block, ADR-27 D4 3중 방어) ───────────────

  /** 이 문서를 가리키는 계획서. materialize의 tocVersion 방어에 필요하다. */
  async findPlanForDocument(
    client: PoolClient,
    tenantId: string,
    documentId: string,
  ): Promise<{ planId: string; currentTocVersionId: string | null; status: string } | null> {
    const res = await client.query(
      `SELECT plan_id, current_toc_version_id, status FROM plan
       WHERE document_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [documentId, tenantId],
    );
    const row = res.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      planId: row.plan_id as string,
      currentTocVersionId: (row.current_toc_version_id as string | null) ?? null,
      status: row.status as string,
    };
  }

  /** 현세대 블록만(`superseded_at IS NULL`). 보호 상태는 걸러내지 않고 그대로
   * 실어 보낸다 — 무엇을 왜 제외했는지 결과에 적어야 하기 때문이다. */
  async listCurrentGeneratedBlocks(
    client: PoolClient,
    planId: string,
    tocVersionId: string,
  ): Promise<GeneratedBlockRow[]> {
    const res = await client.query(
      `SELECT block_id, node_key, outline_level, sort_order, title,
              text_content, protection_state, status
       FROM generated_block
       WHERE plan_id = $1 AND toc_version_id = $2 AND superseded_at IS NULL
       ORDER BY sort_order, node_key`,
      [planId, tocVersionId],
    );
    return (res.rows as Record<string, unknown>[]).map((row) => ({
      blockId: row.block_id as string,
      nodeKey: row.node_key as string,
      outlineLevel: row.outline_level as number,
      sortOrder: row.sort_order as number,
      title: row.title as string,
      textContent: row.text_content as string,
      protectionState: row.protection_state as string,
      status: row.status as string,
    }));
  }
}
