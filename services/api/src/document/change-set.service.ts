import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  canonicalHash,
  type ChangeOperation,
  type ChangeSetOrigin,
  type ChangeSetRequest,
  type ChangeViolation,
  type DiffEntry,
  type DocumentIR,
  type NodeAlias,
} from '@une/domain';
import { applyChangeSet, liftV1, type AuthoredBlockSpec } from '@une/hwpx-engine';
import type { ErrorViolation } from '../common/api-error';
import type { RequestMetaLike } from '../common/controller-utils';
import type { AuthContext } from '../common/request-context';
import { DatabaseService } from '../db/database.service';
import { documentErrors, type ConflictState } from './document-errors';
import { DocumentRepository, type RevisionRow } from './document.repository';
import { DocumentService, conflictStateOf } from './document.service';

/**
 * ChangeSet 적용(UNE-DOC-006)과 자동저장(UNE-DOC-009).
 *
 * ## 트랜잭션 경계
 *
 * `document FOR UPDATE` → head 조회 → 검증 → **순수 함수 호출** →
 * revision + change_set + change_operation N + document 포인터 + audit_log,
 * 전부 한 트랜잭션이다. 엔진 호출을 트랜잭션 안에 두는 것은
 * .claude/rules/backend.md의 "외부 호출은 긴 트랜잭션 밖에서"에 어긋나지
 * 않는다 — `applyChangeSet`은 DB도 네트워크도 모르는 순수 함수이며(설계 07
 * §1.9), 트랜잭션 밖으로 빼면 잠금 해제와 적용 사이에 head가 움직일 수 있다.
 *
 * ## 판정이 감사보다 먼저 롤백되지 않게 하는 법
 *
 * 충돌·거절도 기록이다(US-PLAN-017 감사 열: CHANGESET_APPLIED/REJECTED/
 * CONFLICTED). 그런데 트랜잭션 안에서 예외를 던지면 그 감사 행까지 함께
 * 사라진다. 그래서 트랜잭션은 **판정을 값으로 반환**하고, HTTP 오류는 커밋
 * 이후에 만들어진다.
 */

export interface MaterializeExclusion {
  blockId: string;
  nodeKey: string;
  reason: string;
}

export interface MaterializeReport {
  planId: string;
  tocVersionId: string;
  candidateBlocks: number;
  insertedBlocks: number;
  excluded: MaterializeExclusion[];
}

export interface ChangeSetResultResource {
  changeSetId: string | null;
  documentId: string;
  baseRevisionId: string;
  dryRun: boolean;
  applied: boolean;
  replayed: boolean;
  newRevisionId: string | null;
  newRevisionNo: number | null;
  irHash: string;
  diff: DiffEntry[];
  inverseOperations: ChangeOperation[];
  aliases: NodeAlias[];
  aliasRemovals: NodeAlias[];
  warnings: string[];
  materialize: MaterializeReport | null;
}

export interface AutosaveReceiptResource {
  autosaveId: string;
  documentId: string;
  clientMutationId: string;
  seq: string;
  status: 'ACCEPTED' | 'CONFLICT' | 'SUPERSEDED';
  baseRevisionId: string;
  resultRevisionId: string | null;
  resultRevisionNo: number | null;
  irHash: string | null;
  replayed: boolean;
  receivedAt: string;
}

export interface AutosaveRequestBody {
  baseRevisionId: string;
  delta: { operations: ChangeOperation[] };
  clientMutationId: string;
  seq?: number;
}

export interface ApplyChangeSetBody extends ChangeSetRequest {
  clientMutationId: string;
  checkpointLabel?: string;
  changeSummary?: string;
  /** Undo 계보(0019 §2.4). Undo는 새 ChangeSet이므로 "무엇을 되돌렸는가"가
   * 간선으로 남아야 Redo 대상 판정과 UNDO_CONFLICT를 DB에서 질의할 수 있다. */
  undoesChangeSetId?: string;
}

/** 트랜잭션이 값으로 돌려주는 판정. */
type Verdict<T> =
  | { kind: 'OK'; value: T }
  | { kind: 'CONFLICT'; state: ConflictState }
  | { kind: 'REJECTED'; violations: ErrorViolation[] }
  | { kind: 'MUTATION_REUSED' };

/** ChangeSet 출처 → Revision 출처. 축이 다르다(누가 요청했나 vs 어떤 기제가
 * 만들었나): USER/AI 편집은 둘 다 정규 경로인 CHANGESET이 만든 리비전이다. */
const REVISION_ORIGIN: Readonly<Record<ChangeSetOrigin, string>> = Object.freeze({
  USER: 'CHANGESET',
  AI: 'CHANGESET',
  AUTOSAVE: 'AUTOSAVE',
  UNDO: 'UNDO',
  REDO: 'REDO',
  RESTORE: 'RESTORE',
  MATERIALIZE: 'MATERIALIZE',
});

/** 감사 액션. US-PLAN-015/017의 감사 열이 Undo/Redo를 별도 사건으로 적으므로
 * 출처가 그대로 액션이 된다. 나머지는 CHANGESET_APPLIED 하나로 모인다. */
function appliedAuditAction(origin: ChangeSetOrigin): string {
  if (origin === 'UNDO') return 'UNDO';
  if (origin === 'REDO') return 'REDO';
  return 'CHANGESET_APPLIED';
}

function toErrorViolations(violations: readonly ChangeViolation[]): ErrorViolation[] {
  return violations.map((violation) => ({
    // 화면이 Node/Block Anchor로 되짚을 수 있도록 노드 ID를 field에 싣는다
    // (설계 10 §7.10 ALT-05). 노드가 특정되지 않으면 연산 좌표로 대신한다.
    field:
      violation.nodeId ??
      (violation.operationOrder === undefined
        ? 'operations'
        : `operations[${violation.operationOrder}]`),
    reason: `${violation.reason}: ${violation.detail}`,
  }));
}

/** 선택영역만 뽑아 change_set.selection_json에 남긴다. 본문(payload)은 여기에
 * 오지 않는다 — 명령 저널은 change_operation.target_json의 몫이다. */
function selectionsOf(operations: readonly ChangeOperation[]): unknown[] {
  return operations.filter((op) => op.selection !== undefined).map((op) => op.selection);
}

/** 이 ChangeSet이 건드린 노드 ID(Diff에서). UNDO_CONFLICT 판정의 입력이며,
 * 노드 ID는 본문이 아니라 좌표이므로 저장해도 개인정보 최소화에 어긋나지 않는다. */
function touchedOf(diff: readonly DiffEntry[]): string[] {
  return [...new Set(diff.map((entry) => entry.nodeId))];
}

function touchedNodeIdsOf(selectionJson: Record<string, unknown>): readonly string[] {
  const value = (selectionJson as { touchedNodeIds?: unknown }).touchedNodeIds;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

@Injectable()
export class ChangeSetService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(DocumentRepository) private readonly repo: DocumentRepository,
    @Inject(DocumentService) private readonly documents: DocumentService,
  ) {}

  // ── UNE-DOC-006 ─────────────────────────────────────────────────────────

  async apply(
    auth: AuthContext,
    documentId: string,
    expectedRevisionNo: number,
    body: ApplyChangeSetBody,
    meta: RequestMetaLike,
  ): Promise<ChangeSetResultResource> {
    const verdict = await this.db.withTenant(auth.tenantId, (c) =>
      this.applyInTransaction(c, auth, documentId, expectedRevisionNo, body, meta),
    );
    if (verdict.kind === 'CONFLICT') throw documentErrors.changeSetConflict(verdict.state);
    if (verdict.kind === 'REJECTED') throw documentErrors.unprocessable(verdict.violations);
    if (verdict.kind === 'MUTATION_REUSED') throw documentErrors.mutationIdReused();
    return verdict.value;
  }

  private async applyInTransaction(
    c: PoolClient,
    auth: AuthContext,
    documentId: string,
    expectedRevisionNo: number,
    body: ApplyChangeSetBody,
    meta: RequestMetaLike,
  ): Promise<Verdict<ChangeSetResultResource>> {
    const { document, head } = await this.documents.loadEditContext(c, auth, documentId);
    const fingerprint = canonicalHash({
      baseRevisionId: body.baseRevisionId,
      origin: body.origin,
      operations: body.operations,
      undoesChangeSetId: body.undoesChangeSetId ?? null,
      dryRun: body.dryRun === true,
    });

    // 1) 멱등. 재전송은 새 편집이 아니다 — 잠금을 잡은 뒤 가장 먼저 본다.
    const replay = await this.repo.findChangeSetByMutationId(c, documentId, body.clientMutationId);
    if (replay) {
      const stored = replay.selectionJson as {
        requestHash?: string;
        rejected?: { reason: string; nodeId: string | null; operationOrder: number | null }[];
      };
      if (stored.requestHash !== fingerprint) return { kind: 'MUTATION_REUSED' };
      if (replay.status === 'REJECTED') {
        // 거절된 요청의 재전송에 200을 주면 **첫 응답(422)과 다른 사실**이 된다.
        // 오프라인 큐는 200을 성공으로 처리하고 사용자의 편집은 조용히 사라진다.
        // 같은 요청에는 같은 답을 준다 — 원 거절 사유를 그대로 다시 낸다.
        return {
          kind: 'REJECTED',
          violations: (stored.rejected ?? []).map((item) => ({
            field:
              item.nodeId ??
              (item.operationOrder === null ? 'operations' : `operations[${item.operationOrder}]`),
            reason: `${item.reason}: 앞선 동일 요청이 거절되었습니다.`,
          })),
        };
      }
      return { kind: 'OK', value: await this.replayResult(c, documentId, replay) };
    }

    // 1-a) 집합체 상태(backend.md 검증 순서의 "aggregate state").
    //      승인·검토 중인 문서는 편집 대상이 아니다. 재조회로 고쳐지지 않으므로
    //      409가 아니라 422다.
    if (document.status !== 'EDITING') {
      return {
        kind: 'REJECTED',
        violations: [
          {
            field: 'document.status',
            reason: `상태가 ${document.status}인 문서는 편집할 수 없습니다(EDITING만 가능).`,
          },
        ],
      };
    }

    // 2) baseRevisionId ↔ If-Match 정합. 둘이 어긋나면 요청 자체가 자기모순이라
    //    "누가 먼저 썼나"(409)로 답할 수 없다 — 재조회해도 고쳐지지 않는다.
    const base = (await this.repo.findRevision(
      c,
      documentId,
      body.baseRevisionId,
    )) as RevisionRow | null;
    if (!base) {
      return {
        kind: 'REJECTED',
        violations: [{ field: 'baseRevisionId', reason: '이 문서의 Revision이 아닙니다.' }],
      };
    }
    if (base.revisionNo !== expectedRevisionNo) {
      return {
        kind: 'REJECTED',
        violations: [
          {
            field: 'baseRevisionId',
            reason: `If-Match(${expectedRevisionNo})가 가리키는 Revision과 baseRevisionId(${base.revisionNo})가 다릅니다.`,
          },
        ],
      };
    }

    // 3) 낙관 잠금. If-Match와 body가 일치해도 head가 이미 움직였을 수 있다.
    if (head.revisionNo !== expectedRevisionNo) {
      if (!body.dryRun) {
        await this.documents.insertDocumentAudit(
          c,
          auth,
          meta,
          'CHANGESET_CONFLICTED',
          documentId,
          {
            baseRevisionId: body.baseRevisionId,
            baseRevisionNo: base.revisionNo,
            headRevisionId: head.revisionId,
            headRevisionNo: head.revisionNo,
            origin: body.origin,
          },
        );
      }
      return { kind: 'CONFLICT', state: conflictStateOf(head) };
    }

    // 3-a) 서버측 Undo/Redo: 연산은 요청이 아니라 저장된 역연산에서 온다.
    let operations = body.operations;
    if (body.undoesChangeSetId) {
      const undo = await this.resolveUndo(c, documentId, body.undoesChangeSetId);
      if (!undo.ok) return { kind: 'REJECTED', violations: undo.violations };
      operations = undo.operations;
    }

    // 4) 엔진(순수 함수). ID 좌표가 되므로 changeSetId를 먼저 발급한다(ADR-30 D2).
    const changeSetId = randomUUID();
    const outcome = await this.runEngine(c, auth, documentId, changeSetId, head, {
      ...body,
      operations,
    });
    if (!outcome.ok) {
      if (!body.dryRun) {
        // 거절도 보존한다(US-PLAN-017 A-01). 리비전은 만들지 않으므로 문서는 불변.
        await this.repo.insertChangeSet(c, {
          documentId,
          baseRevisionId: body.baseRevisionId,
          clientMutationId: body.clientMutationId,
          selectionJson: {
            schema: 'change-set-request/1',
            requestHash: fingerprint,
            selections: selectionsOf(operations),
            aliases: [],
            aliasRemovals: [],
            touchedNodeIds: [],
            rejected: outcome.violations.map((v) => ({
              reason: v.reason,
              nodeId: v.nodeId ?? null,
              operationOrder: v.operationOrder ?? null,
            })),
          },
          status: 'REJECTED',
          origin: body.origin,
          undoesChangeSetId: null,
          createdBy: auth.userId,
          changeSetId,
        });
        await this.documents.insertDocumentAudit(c, auth, meta, 'CHANGESET_REJECTED', documentId, {
          changeSetId,
          origin: body.origin,
          // 사유 코드와 노드 ID만 남긴다. detail 문자열에는 본문이 섞일 수
          // 있으므로 감사에도 넣지 않는다.
          reasons: outcome.violations.map((v) => v.reason),
          nodeIds: outcome.violations.map((v) => v.nodeId ?? null),
        });
      }
      return { kind: 'REJECTED', violations: toErrorViolations(outcome.violations) };
    }

    // 5) dryRun: 계산은 끝났지만 아무것도 쓰지 않는다(US-PLAN-017 AC-01).
    if (body.dryRun) {
      return {
        kind: 'OK',
        value: {
          changeSetId: null,
          documentId,
          baseRevisionId: body.baseRevisionId,
          dryRun: true,
          applied: false,
          replayed: false,
          newRevisionId: null,
          newRevisionNo: null,
          irHash: outcome.irHash,
          diff: [...outcome.diff],
          inverseOperations: [...outcome.inverseOperations],
          aliases: [...outcome.aliases],
          aliasRemovals: [...outcome.aliasRemovals],
          warnings: [...outcome.warnings],
          materialize: outcome.materialize,
        },
      };
    }

    // 6) 커밋 대상 일체.
    await this.repo.insertChangeSet(c, {
      documentId,
      baseRevisionId: body.baseRevisionId,
      clientMutationId: body.clientMutationId,
      selectionJson: {
        schema: 'change-set-request/1',
        requestHash: fingerprint,
        selections: selectionsOf(operations),
        aliases: outcome.aliases,
        aliasRemovals: outcome.aliasRemovals,
        // UNDO_CONFLICT 판정의 입력(ADR-30 D7). Diff의 노드 ID만 남긴다.
        touchedNodeIds: touchedOf(outcome.diff),
      },
      status: 'APPLIED',
      origin: body.origin,
      undoesChangeSetId: body.undoesChangeSetId ?? null,
      createdBy: auth.userId,
      changeSetId,
    });
    await this.writeOperations(c, changeSetId, operations, outcome.inverseOperations);
    const ir: DocumentIR = { ...outcome.ir, revision: null };
    const revision = await this.repo.insertRevision(c, {
      documentId,
      revisionNo: head.revisionNo + 1,
      parentRevisionId: head.revisionId,
      ir,
      irHash: outcome.irHash,
      changeSummary: body.changeSummary?.trim() || null,
      origin: REVISION_ORIGIN[body.origin],
      checkpointLabel: body.checkpointLabel?.trim() || null,
      createdBy: auth.userId,
    });
    await this.repo.setChangeSetResult(c, changeSetId, revision.revisionId, documentId);
    await this.repo.setCurrentRevision(c, auth.tenantId, documentId, revision.revisionId);

    await this.documents.insertDocumentAudit(
      c,
      auth,
      meta,
      appliedAuditAction(body.origin),
      documentId,
      {
        changeSetId,
        origin: body.origin,
        ...(body.undoesChangeSetId ? { undoesChangeSetId: body.undoesChangeSetId } : {}),
        operationCount: operations.length,
        operationTypes: operations.map((op) => op.type),
        newRevisionId: revision.revisionId,
        newRevisionNo: revision.revisionNo,
        ...(outcome.materialize ? { materialize: outcome.materialize } : {}),
      },
      { headRevisionId: head.revisionId, headRevisionNo: head.revisionNo, irHash: head.irHash },
    );
    await this.documents.insertDocumentAudit(c, auth, meta, 'REVISION_SAVED', documentId, {
      revisionId: revision.revisionId,
      revisionNo: revision.revisionNo,
      origin: REVISION_ORIGIN[body.origin],
      irHash: outcome.irHash,
      checkpointLabel: revision.checkpointLabel,
    });
    if (revision.checkpointLabel) {
      await this.documents.insertDocumentAudit(c, auth, meta, 'CHECKPOINT_CREATED', documentId, {
        revisionId: revision.revisionId,
        checkpointLabel: revision.checkpointLabel,
      });
    }

    return {
      kind: 'OK',
      value: {
        changeSetId,
        documentId,
        baseRevisionId: body.baseRevisionId,
        dryRun: false,
        applied: true,
        replayed: false,
        newRevisionId: revision.revisionId,
        newRevisionNo: revision.revisionNo,
        irHash: outcome.irHash,
        diff: [...outcome.diff],
        inverseOperations: [...outcome.inverseOperations],
        aliases: [...outcome.aliases],
        aliasRemovals: [...outcome.aliasRemovals],
        warnings: [...outcome.warnings],
        materialize: outcome.materialize,
      },
    };
  }

  // ── UNE-DOC-009 ─────────────────────────────────────────────────────────

  async autosave(
    auth: AuthContext,
    documentId: string,
    expectedRevisionNo: number,
    body: AutosaveRequestBody,
    meta: RequestMetaLike,
  ): Promise<AutosaveReceiptResource> {
    const verdict = await this.db.withTenant(auth.tenantId, (c) =>
      this.autosaveInTransaction(c, auth, documentId, expectedRevisionNo, body, meta),
    );
    if (verdict.kind === 'CONFLICT') throw documentErrors.autosaveConflict(verdict.state);
    if (verdict.kind === 'REJECTED') throw documentErrors.unprocessable(verdict.violations);
    if (verdict.kind === 'MUTATION_REUSED') throw documentErrors.mutationIdReused();
    return verdict.value;
  }

  private async autosaveInTransaction(
    c: PoolClient,
    auth: AuthContext,
    documentId: string,
    expectedRevisionNo: number,
    body: AutosaveRequestBody,
    meta: RequestMetaLike,
  ): Promise<Verdict<AutosaveReceiptResource>> {
    const { document, head } = await this.documents.loadEditContext(c, auth, documentId);
    const delta = { operations: body.delta.operations };
    const fingerprint = canonicalHash(delta);
    if (document.status !== 'EDITING') {
      return {
        kind: 'REJECTED',
        violations: [
          {
            field: 'document.status',
            reason: `상태가 ${document.status}인 문서는 편집할 수 없습니다(EDITING만 가능).`,
          },
        ],
      };
    }

    // 1) 멱등. 오프라인 큐는 같은 항목을 여러 번 재전송하는 것이 정상 동작이다.
    const existing = await this.repo.findAutosaveByMutationId(c, documentId, body.clientMutationId);
    if (existing) {
      if (canonicalHash(existing.deltaJson) !== fingerprint) return { kind: 'MUTATION_REUSED' };
      const revision = existing.resultRevisionId
        ? ((await this.repo.findRevision(
            c,
            documentId,
            existing.resultRevisionId,
          )) as RevisionRow | null)
        : null;
      return {
        kind: 'OK',
        value: {
          autosaveId: existing.autosaveId,
          documentId,
          clientMutationId: existing.clientMutationId,
          seq: existing.seq,
          status: existing.status as AutosaveReceiptResource['status'],
          baseRevisionId: existing.baseRevisionId,
          resultRevisionId: existing.resultRevisionId,
          resultRevisionNo: revision?.revisionNo ?? null,
          irHash: revision?.irHash ?? null,
          replayed: true,
          receivedAt: existing.createdAt.toISOString(),
        },
      };
    }

    const seq = body.seq ?? (await this.repo.nextAutosaveSeq(c, documentId));

    // 2) SUPERSEDED를 충돌보다 먼저 본다. 재동기화로 뒤늦게 도착한 항목은
    //    실패가 아니라 무해한 폐기이며(0019 §1), 그때는 baseRevisionId가
    //    낡아 있는 것이 정상이라 충돌로 판정하면 사용자에게 거짓 경보가 된다.
    const maxAccepted = await this.repo.maxAcceptedAutosaveSeq(c, documentId);
    if (maxAccepted !== null && seq <= maxAccepted) {
      const row = await this.repo.insertAutosave(c, {
        documentId,
        baseRevisionId: body.baseRevisionId,
        clientMutationId: body.clientMutationId,
        seq,
        delta,
        resultRevisionId: null,
        status: 'SUPERSEDED',
        createdBy: auth.userId,
      });
      await this.documents.insertDocumentAudit(c, auth, meta, 'AUTOSAVE_SUCCESS', documentId, {
        autosaveId: row.autosaveId,
        status: 'SUPERSEDED',
        seq,
        supersededBySeq: maxAccepted,
      });
      return { kind: 'OK', value: this.toReceipt(row, null, null) };
    }

    // 2-a) 자기모순 요청은 409가 아니라 422다(ADR-30 D4 — 적용 경로와 같은 규칙).
    //      If-Match가 가리키는 Revision과 baseRevisionId가 서로 다른 Revision을
    //      가리키면 재조회해도 고쳐지지 않으므로, 409로 답하면 클라이언트가 무한히
    //      재시도한다.
    const requestedBase = (await this.repo.findRevision(
      c,
      documentId,
      body.baseRevisionId,
    )) as RevisionRow | null;
    if (!requestedBase || requestedBase.revisionNo !== expectedRevisionNo) {
      return {
        kind: 'REJECTED',
        violations: [
          {
            field: 'baseRevisionId',
            reason: requestedBase
              ? `If-Match(${expectedRevisionNo})가 가리키는 Revision과 baseRevisionId(${requestedBase.revisionNo})가 다릅니다.`
              : '이 문서의 Revision이 아닙니다.',
          },
        ],
      };
    }

    // 3) 충돌. 판정 자체가 기록으로 남아야 화면이 "저장 실패"를 표시할 수 있다
    //    (US-PLAN-020 AC-02) — 그래서 행을 쓰고 커밋한 뒤 409를 만든다.
    if (head.revisionNo !== expectedRevisionNo) {
      const row = await this.repo.insertAutosave(c, {
        documentId,
        // 저널의 `base_revision_id`는 **요청이 기준으로 삼은 Revision**이다
        // (0019 §1 COMMENT). head를 적으면 US-PLAN-020 AC-03의 "command
        // journal로 재현"이 불가능해진다 — 무엇을 기준으로 만든 delta인지가
        // 사라지기 때문이다.
        baseRevisionId: body.baseRevisionId,
        clientMutationId: body.clientMutationId,
        seq,
        delta,
        resultRevisionId: null,
        status: 'CONFLICT',
        createdBy: auth.userId,
      });
      await this.documents.insertDocumentAudit(c, auth, meta, 'AUTOSAVE_FAIL', documentId, {
        autosaveId: row.autosaveId,
        status: 'CONFLICT',
        seq,
        requestedBaseRevisionId: body.baseRevisionId,
        headRevisionId: head.revisionId,
        headRevisionNo: head.revisionNo,
      });
      return { kind: 'CONFLICT', state: conflictStateOf(head) };
    }

    // 4) 적용. batch 1건 = 저널 1행 + ChangeSet 1건 + revision 1건.
    const changeSetId = randomUUID();
    const outcome = await this.runEngine(c, auth, documentId, changeSetId, head, {
      baseRevisionId: body.baseRevisionId,
      origin: 'AUTOSAVE',
      operations: delta.operations,
    });
    if (!outcome.ok) {
      const row = await this.repo.insertAutosave(c, {
        documentId,
        baseRevisionId: body.baseRevisionId,
        clientMutationId: body.clientMutationId,
        seq,
        delta,
        resultRevisionId: null,
        // 어휘는 ACCEPTED/CONFLICT/SUPERSEDED 셋뿐이다(0019 §1). 적용 불가는
        // 새 상태를 지어내지 않고 CONFLICT로 남긴다 — 사용자에게 보이는 사실이
        // "이 batch는 반영되지 않았다"로 같기 때문이다.
        status: 'CONFLICT',
        createdBy: auth.userId,
      });
      await this.documents.insertDocumentAudit(c, auth, meta, 'AUTOSAVE_FAIL', documentId, {
        autosaveId: row.autosaveId,
        status: 'CONFLICT',
        seq,
        reasons: outcome.violations.map((v) => v.reason),
      });
      return { kind: 'REJECTED', violations: toErrorViolations(outcome.violations) };
    }

    // 4-a) 내용이 그대로면 새 리비전을 만들지 않는다(ADR-30 D8).
    //
    // 같은 텍스트 재입력·입력 후 즉시 취소 같은 batch는 정상 동작인데, 그때마다
    // 리비전을 하나씩 쌓으면 버전이력이 의미 없는 행으로 덮인다. `ir_hash`가
    // head와 같다는 것은 "이 batch는 문서를 움직이지 않았다"는 사실이므로,
    // 기존 head를 receipt로 돌려준다(plan `confirmSnapshot`의 content-hash 중복
    // 제거 선례). 저널 행은 남긴다 — 저장 요청이 있었다는 사실 자체는 기록이다.
    if (outcome.irHash === head.irHash) {
      const unchanged = await this.repo.insertAutosave(c, {
        documentId,
        baseRevisionId: body.baseRevisionId,
        clientMutationId: body.clientMutationId,
        seq,
        delta,
        resultRevisionId: head.revisionId,
        status: 'ACCEPTED',
        createdBy: auth.userId,
      });
      await this.documents.insertDocumentAudit(c, auth, meta, 'AUTOSAVE_SUCCESS', documentId, {
        autosaveId: unchanged.autosaveId,
        status: 'ACCEPTED',
        seq,
        unchanged: true,
        headRevisionId: head.revisionId,
        headRevisionNo: head.revisionNo,
      });
      return { kind: 'OK', value: this.toReceipt(unchanged, head.revisionNo, head.irHash) };
    }

    await this.repo.insertChangeSet(c, {
      documentId,
      baseRevisionId: body.baseRevisionId,
      clientMutationId: body.clientMutationId,
      selectionJson: {
        schema: 'change-set-request/1',
        requestHash: fingerprint,
        selections: selectionsOf(delta.operations),
        aliases: outcome.aliases,
        aliasRemovals: outcome.aliasRemovals,
        touchedNodeIds: touchedOf(outcome.diff),
        autosaveSeq: seq,
      },
      status: 'APPLIED',
      origin: 'AUTOSAVE',
      undoesChangeSetId: null,
      createdBy: auth.userId,
      changeSetId,
    });
    await this.writeOperations(c, changeSetId, delta.operations, outcome.inverseOperations);
    const revision = await this.repo.insertRevision(c, {
      documentId,
      revisionNo: head.revisionNo + 1,
      parentRevisionId: head.revisionId,
      ir: { ...outcome.ir, revision: null },
      irHash: outcome.irHash,
      changeSummary: null,
      origin: 'AUTOSAVE',
      checkpointLabel: null,
      createdBy: auth.userId,
    });
    await this.repo.setChangeSetResult(c, changeSetId, revision.revisionId, documentId);
    await this.repo.setCurrentRevision(c, auth.tenantId, documentId, revision.revisionId);
    const row = await this.repo.insertAutosave(c, {
      documentId,
      baseRevisionId: body.baseRevisionId,
      clientMutationId: body.clientMutationId,
      seq,
      delta,
      resultRevisionId: revision.revisionId,
      status: 'ACCEPTED',
      createdBy: auth.userId,
    });
    await this.documents.insertDocumentAudit(c, auth, meta, 'AUTOSAVE_SUCCESS', documentId, {
      autosaveId: row.autosaveId,
      status: 'ACCEPTED',
      seq,
      changeSetId,
      newRevisionId: revision.revisionId,
      newRevisionNo: revision.revisionNo,
    });
    await this.documents.insertDocumentAudit(c, auth, meta, 'REVISION_SAVED', documentId, {
      revisionId: revision.revisionId,
      revisionNo: revision.revisionNo,
      origin: 'AUTOSAVE',
      irHash: outcome.irHash,
    });
    return {
      kind: 'OK',
      value: this.toReceipt(row, revision.revisionNo, outcome.irHash),
    };
  }

  // ── 공통 ────────────────────────────────────────────────────────────────

  private toReceipt(
    row: {
      autosaveId: string;
      documentId: string;
      clientMutationId: string;
      seq: string;
      status: string;
      baseRevisionId: string;
      resultRevisionId: string | null;
      createdAt: Date;
    },
    resultRevisionNo: number | null,
    irHash: string | null,
  ): AutosaveReceiptResource {
    return {
      autosaveId: row.autosaveId,
      documentId: row.documentId,
      clientMutationId: row.clientMutationId,
      seq: row.seq,
      status: row.status as AutosaveReceiptResource['status'],
      baseRevisionId: row.baseRevisionId,
      resultRevisionId: row.resultRevisionId,
      resultRevisionNo,
      irHash,
      replayed: false,
      receivedAt: row.createdAt.toISOString(),
    };
  }

  private async replayResult(
    c: PoolClient,
    documentId: string,
    replay: {
      changeSetId: string;
      baseRevisionId: string;
      resultRevisionId: string | null;
      status: string;
      selectionJson: Record<string, unknown>;
    },
  ): Promise<ChangeSetResultResource> {
    const revision = replay.resultRevisionId
      ? ((await this.repo.findRevision(
          c,
          documentId,
          replay.resultRevisionId,
        )) as RevisionRow | null)
      : null;
    const stored = replay.selectionJson as {
      aliases?: NodeAlias[];
      aliasRemovals?: NodeAlias[];
    };
    return {
      changeSetId: replay.changeSetId,
      documentId,
      baseRevisionId: replay.baseRevisionId,
      dryRun: false,
      applied: replay.status === 'APPLIED',
      // Diff는 재생산하지 않는다. 재전송의 목적은 "적용됐는가와 새 리비전이
      // 무엇인가"이며, Diff를 위해 문서 본문 미리보기를 다시 저장해 두는 것은
      // 개인정보 최소화에 어긋난다(.claude/rules/security.md).
      replayed: true,
      newRevisionId: revision?.revisionId ?? null,
      newRevisionNo: revision?.revisionNo ?? null,
      irHash: revision?.irHash ?? '',
      diff: [],
      inverseOperations: await this.repo.findInverseOperations(c, replay.changeSetId, documentId),
      aliases: stored.aliases ?? [],
      aliasRemovals: stored.aliasRemovals ?? [],
      warnings: [],
      materialize: null,
    };
  }

  /**
   * 명령 저널. `target_json`이 그 연산 자체(선택·앵커·소스·payload)이고,
   * 역연산 집합은 **ChangeSet 단위 산출물**이라 가장 낮은 order 행의
   * `after_json.inverse`에 붙인다 — 엔진이 before-image에서 파생하므로 요청
   * 연산과 1:1로 대응하지 않으며, 흩어 놓으면 그 대응을 지어내야 한다.
   */
  private async writeOperations(
    c: PoolClient,
    changeSetId: string,
    operations: readonly ChangeOperation[],
    inverseOperations: readonly ChangeOperation[],
  ): Promise<void> {
    const ordered = [...operations].sort((a, b) => a.order - b.order);
    await this.repo.insertOperations(
      c,
      changeSetId,
      ordered.map((op, index) => ({
        order: op.order,
        type: op.type,
        target: {
          ...(op.selection === undefined ? {} : { selection: op.selection }),
          ...(op.anchor === undefined ? {} : { anchor: op.anchor }),
          ...(op.source === undefined ? {} : { source: op.source }),
          ...(op.payload === undefined ? {} : { payload: op.payload }),
        },
        before: null,
        after: index === 0 ? { inverse: inverseOperations } : null,
      })),
    );
  }

  /** 엔진 입력 조립 + materialize 주입. */
  private async runEngine(
    c: PoolClient,
    auth: AuthContext,
    documentId: string,
    changeSetId: string,
    head: RevisionRow,
    request: ChangeSetRequest,
  ): Promise<
    | {
        ok: true;
        ir: DocumentIR;
        irHash: string;
        diff: readonly DiffEntry[];
        inverseOperations: readonly ChangeOperation[];
        aliases: readonly NodeAlias[];
        aliasRemovals: readonly NodeAlias[];
        warnings: readonly string[];
        materialize: MaterializeReport | null;
      }
    | { ok: false; violations: readonly ChangeViolation[] }
  > {
    const profile = await this.repo.findTemplateProfile(c, documentId);
    const materializeSources = request.operations
      .map((op) => op.source)
      .filter(
        (source): source is { kind: 'GENERATED_BLOCKS'; planId: string; tocVersionId: string } =>
          source?.kind === 'GENERATED_BLOCKS',
      );
    const materialize = await this.prepareMaterialize(c, auth, documentId, materializeSources);

    const result = applyChangeSet({
      ir: liftV1(head.irJson),
      request,
      changeSetId,
      currentRevisionId: head.revisionId,
      prototypes: profile?.profile.prototypes ?? [],
      staticRegionAnchors: (profile?.profile.staticRegions ?? []).map((region) => region.locator),
      aliases: await this.aliasHistory(c, documentId),
      generatedBlocks: materialize.provider,
    });
    if (!result.ok) {
      // fail-closed 사유가 있으면 엔진의 일반 메시지 대신 그것을 앞세운다.
      const violations = materialize.blockedReason
        ? [
            {
              reason: 'UNSUPPORTED_OPERATION' as const,
              detail: materialize.blockedReason,
            },
            ...result.violations,
          ]
        : result.violations;
      return { ok: false, violations };
    }
    return {
      ok: true,
      ir: result.ir,
      irHash: result.irHash,
      diff: result.diff,
      inverseOperations: result.inverseOperations,
      aliases: result.aliases,
      aliasRemovals: result.aliasRemovals,
      warnings: [...result.warnings, ...materialize.warnings],
      materialize: materialize.report,
    };
  }

  /**
   * 이전 ChangeSet들이 남긴 alias 이력(§1.8-2). 제거분을 반영해 접는다 —
   * MERGE를 되돌린 뒤에도 "right → left" 재사상이 살아 있으면 되살아난 문단을
   * 가리키는 선택이 계속 왼쪽으로 끌려간다.
   *
   * append-only 목록만으로는 복원(UNE-DOC-008)이 만든 무효화를 표현할 수 없다.
   * 그래서 이 목록은 **후보**이고, 최종 판정은 엔진의 `resolveAlias`가 "노드가
   * 현재 IR에 살아 있으면 재사상하지 않는다"로 내린다(ADR-30 D14 보정) —
   * 이력 길이와 무관하게 현재 문서 상태만으로 결론이 난다.
   */
  private async aliasHistory(c: PoolClient, documentId: string): Promise<NodeAlias[]> {
    const rows = await this.repo.listAppliedChangeSets(c, documentId);
    const aliases: NodeAlias[] = [];
    for (const row of rows) {
      const stored = row.selectionJson as {
        aliases?: NodeAlias[];
        aliasRemovals?: NodeAlias[];
      };
      for (const alias of stored.aliases ?? []) aliases.push(alias);
      for (const removal of stored.aliasRemovals ?? []) {
        const index = aliases.findIndex(
          (item) => item.from === removal.from && item.to === removal.to,
        );
        if (index >= 0) aliases.splice(index, 1);
      }
    }
    return aliases;
  }

  /**
   * 서버측 Undo/Redo (ADR-30 D6/D7 보정).
   *
   * ## 왜 클라이언트가 역연산을 되보내지 않는가
   *
   * 원안은 "응답의 `inverseOperations`를 그대로 다시 제출한다"였다. 그런데 그
   * 배열은 **아직 존재하지 않는 개정**을 기준으로 하고(센티널) 삭제 복원에는
   * 원본 블록 IR이 통째로 들어 있다. 그것을 요청 표면에서 받으려면 임의의 IR
   * 조각을 신뢰해야 하고, 그 순간 클라이언트가 `origin:'SOURCE'`·위조 앵커·
   * `locked:true` 노드를 문서에 직접 심을 수 있게 된다(판별 유니온은 컴파일
   * 시점 보장이라 이 경로를 막지 못한다). 역연산은 **서버가 이미 갖고 있는
   * 데이터**이므로, 클라이언트는 "무엇을 되돌릴지"만 지목하면 된다.
   *
   * ## UNDO_CONFLICT (US-PLAN-017 E-03)
   *
   * 대상 ChangeSet 이후에 **그 노드를 건드린** ChangeSet이 있으면 자동 Undo를
   * 거부하고 영향 노드를 돌려준다. 계보 판정에 쓰는 노드 집합은 적용 시점의
   * Diff에서 나온 `touchedNodeIds`다.
   */
  private async resolveUndo(
    c: PoolClient,
    documentId: string,
    undoesChangeSetId: string,
  ): Promise<
    { ok: true; operations: ChangeOperation[] } | { ok: false; violations: ErrorViolation[] }
  > {
    const target = await this.repo.findChangeSet(c, documentId, undoesChangeSetId);
    if (!target) {
      return {
        ok: false,
        violations: [{ field: 'undoesChangeSetId', reason: '이 문서의 ChangeSet이 아닙니다.' }],
      };
    }
    if (target.status !== 'APPLIED') {
      return {
        ok: false,
        violations: [
          {
            field: 'undoesChangeSetId',
            reason: `적용되지 않은 ChangeSet(${target.status})은 되돌릴 수 없습니다.`,
          },
        ],
      };
    }

    const touched = new Set(touchedNodeIdsOf(target.selectionJson));
    const later = await this.repo.listAppliedChangeSets(c, documentId, target.changeSetId);
    const conflicting: string[] = [];
    for (const row of later) {
      // 이미 이 ChangeSet을 되돌린 기록은 충돌이 아니라 상태다(이중 Undo는
      // 아래 result 검사가 아니라 사용자의 Redo로 처리된다).
      if (row.undoesChangeSetId === target.changeSetId) continue;
      for (const nodeId of touchedNodeIdsOf(row.selectionJson)) {
        if (touched.has(nodeId) && !conflicting.includes(nodeId)) conflicting.push(nodeId);
      }
    }
    if (conflicting.length > 0) {
      return {
        ok: false,
        violations: conflicting.map((nodeId) => ({
          field: nodeId,
          reason: 'UNDO_CONFLICT: 되돌리려는 편집 이후 이 노드가 다시 수정되었습니다.',
        })),
      };
    }

    const operations = await this.repo.findInverseOperations(c, undoesChangeSetId, documentId);
    if (operations.length === 0) {
      return {
        ok: false,
        violations: [
          {
            field: 'undoesChangeSetId',
            reason: '이 ChangeSet에는 되돌릴 역연산이 없습니다.',
          },
        ],
      };
    }
    return { ok: true, operations };
  }

  /**
   * materialize(ADR-27 D4 3중 방어를 문서 실체화 경로로 이식).
   *
   *   1. `plan.current_toc_version_id ≠ 요청 tocVersionId` → fail-closed.
   *      낡은 목차로 만든 블록을 문서에 넣으면 노드키 앵커가 고아가 된다.
   *   2. `superseded_at IS NULL`인 현세대 블록만.
   *   3. `protection_state != 'NONE'`은 제외하고 **사유를 결과에 싣는다** —
   *      조용히 빠지면 사용자는 문서가 왜 비어 있는지 알 수 없다.
   */
  private async prepareMaterialize(
    c: PoolClient,
    auth: AuthContext,
    documentId: string,
    sources: readonly { planId: string; tocVersionId: string }[],
  ): Promise<{
    provider:
      | ((request: { planId: string; tocVersionId: string }) => AuthoredBlockSpec[] | null)
      | undefined;
    report: MaterializeReport | null;
    warnings: string[];
    blockedReason: string | null;
  }> {
    if (sources.length === 0) {
      return { provider: undefined, report: null, warnings: [], blockedReason: null };
    }
    if (sources.length > 1) {
      // 첫 소스만 검사하면 두 번째부터가 3중 방어를 그냥 지나간다(낡은
      // 목차버전 요청이 200으로 끝나고 같은 블록이 두 번 삽입된다). 한
      // ChangeSet이 같은 생성 결과를 여러 번 실체화할 이유도 없으므로
      // **소스는 하나로 닫는다** — 검사할 수 없는 형태를 허용하지 않는 것이
      // fail-closed의 뜻이다.
      return {
        provider: () => null,
        report: null,
        warnings: [],
        blockedReason: '한 ChangeSet에는 GENERATED_BLOCKS 소스를 하나만 실을 수 있습니다.',
      };
    }
    const source = sources[0];
    const plan = await this.repo.findPlanForDocument(c, auth.tenantId, documentId);
    let blockedReason: string | null = null;
    let blocks: AuthoredBlockSpec[] | null = null;
    let report: MaterializeReport | null = null;
    const warnings: string[] = [];

    if (!plan) {
      blockedReason = '이 문서에 연결된 계획서가 없어 생성 블록을 실체화할 수 없습니다.';
    } else if (plan.planId !== source.planId) {
      blockedReason = 'planId가 이 문서의 계획서와 다릅니다.';
    } else if (plan.currentTocVersionId !== source.tocVersionId) {
      blockedReason = `요청한 목차버전이 계획서의 현재 목차버전이 아닙니다(현재: ${plan.currentTocVersionId ?? '없음'}).`;
    } else {
      const rows = await this.repo.listCurrentGeneratedBlocks(
        c,
        source.planId,
        source.tocVersionId,
      );
      const excluded: MaterializeExclusion[] = [];
      const specs: AuthoredBlockSpec[] = [];
      for (const row of rows) {
        if (row.protectionState !== 'NONE') {
          excluded.push({
            blockId: row.blockId,
            nodeKey: row.nodeKey,
            reason: `PROTECTED_BLOCK(${row.protectionState})`,
          });
          continue;
        }
        if (row.status !== 'GENERATED') {
          excluded.push({
            blockId: row.blockId,
            nodeKey: row.nodeKey,
            reason: `NOT_GENERATED(${row.status})`,
          });
          continue;
        }
        specs.push({
          text: row.textContent,
          styleRole: row.outlineLevel > 0 ? `OUTLINE_${row.outlineLevel}` : 'BODY',
          ...(row.outlineLevel > 0 ? { outlineLevel: row.outlineLevel } : {}),
        });
      }
      blocks = specs;
      report = {
        planId: source.planId,
        tocVersionId: source.tocVersionId,
        candidateBlocks: rows.length,
        insertedBlocks: specs.length,
        excluded,
      };
      if (excluded.length > 0) {
        warnings.push(`보호/미완성 블록 ${excluded.length}건은 실체화에서 제외되었습니다.`);
      }
      if (specs.length === 0) {
        blockedReason = '실체화할 수 있는 생성 블록이 없습니다(전부 보호 상태이거나 미생성).';
      }
    }

    return {
      // fail-closed: 방어 중 하나라도 걸리면 주입 자체를 하지 않는다. 엔진은
      // 소스가 없으면 해당 연산을 위반으로 끝내므로 부분 적용이 생길 수 없다.
      //
      // 주입 함수는 **인자에 의존한다**: 엔진은 연산마다 그 연산의 좌표를 넘기고,
      // 검증된 좌표와 다르면 null을 준다. 인자를 무시하고 항상 같은 블록을
      // 돌려주면 "검사한 소스"와 "삽입되는 소스"가 어긋날 수 있다.
      provider: blockedReason
        ? () => null
        : (request) =>
            request.planId === source.planId && request.tocVersionId === source.tocVersionId
              ? blocks
              : null,
      report,
      warnings,
      blockedReason,
    };
  }
}
