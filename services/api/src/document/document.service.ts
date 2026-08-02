import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { documentIrHash, type DocumentIR } from '@une/domain';
import { liftV1 } from '@une/hwpx-engine';
import { AuditRepository } from '../common/audit.repository';
import type { RequestMetaLike } from '../common/controller-utils';
import type { AuthContext } from '../common/request-context';
import { DatabaseService } from '../db/database.service';
import { documentErrors, type ConflictState } from './document-errors';
import {
  DocumentRepository,
  type DocumentRow,
  type RevisionRow,
  type RevisionSummaryRow,
} from './document.repository';

/** 계약 DocumentIrResource. */
export interface DocumentIrResource {
  documentId: string;
  revisionId: string;
  revisionNo: number;
  irHash: string;
  origin: string;
  checkpointLabel: string | null;
  /** 현재 head. 과거 Revision을 조회했을 때 클라이언트가 "쓰기 기준"을 알 수
   * 있게 함께 싣는다 — 편집은 언제나 head 위에서만 일어난다. */
  headRevisionId: string;
  headRevisionNo: number;
  irVersion: DocumentIR['irVersion'];
  /** v1로 적힌 행은 liftV1로 승격해 내보낸다(읽기 경로 정규화, ADR-30 D3). */
  liftedFromV1: boolean;
  ir: DocumentIR;
  createdBy: string;
  createdAt: string;
}

export interface RevisionResource {
  revisionId: string;
  documentId: string;
  revisionNo: number;
  parentRevisionId: string | null;
  irHash: string;
  changeSummary: string | null;
  origin: string;
  checkpointLabel: string | null;
  isHead: boolean;
  createdBy: string;
  createdAt: string;
}

export interface RevisionPage {
  items: RevisionResource[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  headRevisionId: string | null;
  headRevisionNo: number | null;
}

export interface RestoreResult {
  revision: RevisionResource;
  changeSetId: string;
  restoredFromRevisionId: string;
  restoredFromRevisionNo: number;
}

function iso(value: Date): string {
  return value.toISOString();
}

export function toRevisionResource(
  row: RevisionSummaryRow,
  headRevisionNo: number,
): RevisionResource {
  return {
    revisionId: row.revisionId,
    documentId: row.documentId,
    revisionNo: row.revisionNo,
    parentRevisionId: row.parentRevisionId,
    irHash: row.irHash,
    changeSummary: row.changeSummary,
    origin: row.origin,
    checkpointLabel: row.checkpointLabel,
    isHead: row.revisionNo === headRevisionNo,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
  };
}

/**
 * 편집 트랜잭션의 공통 진입 상태.
 *
 * `document` 한 행을 `FOR UPDATE`로 잡은 뒤 head를 읽는다. 이 순서가 CC-150의
 * 동시성 계약 전부다: 같은 문서에 대한 두 요청 중 하나만 이 지점을 통과하고,
 * 나머지는 잠금이 풀린 뒤 **이미 움직인 head**를 보게 되어 409로 끝난다.
 */
export interface EditContext {
  document: DocumentRow;
  head: RevisionRow;
}

export function conflictStateOf(head: {
  revisionId: string;
  revisionNo: number;
  irHash: string;
}): ConflictState {
  return {
    currentRevisionId: head.revisionId,
    currentRevisionNo: head.revisionNo,
    headIrHash: head.irHash,
  };
}

@Injectable()
export class DocumentService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(DocumentRepository) private readonly repo: DocumentRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  /**
   * UNE-DOC-005. `revisionId`가 없으면 head.
   *
   * ETag는 **반환한 표현의** revision_no다. 기본 경로(head 조회)에서는 그것이
   * 곧 head의 번호이므로 바로 If-Match로 쓸 수 있고, 과거 Revision을 명시
   * 조회했을 때는 head와 다른 값이 나가 그대로 쓰면 409가 된다 — 과거 표현을
   * 기준으로 쓰기를 시도하는 것은 실제로 충돌이므로, 이것이 안전한 쪽이다.
   */
  async getIr(
    auth: AuthContext,
    documentId: string,
    revisionId: string | undefined,
  ): Promise<DocumentIrResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const document = await this.repo.findDocument(c, auth.tenantId, documentId);
      if (!document) throw documentErrors.documentNotFound();
      const head = (await this.repo.findHeadRevision(c, documentId)) as RevisionSummaryRow | null;
      if (!head) throw documentErrors.revisionNotFound();
      const target = revisionId
        ? ((await this.repo.findRevision(c, documentId, revisionId, {
            withIr: true,
          })) as RevisionRow | null)
        : ((await this.repo.findRevision(c, documentId, head.revisionId, {
            withIr: true,
          })) as RevisionRow | null);
      if (!target) throw documentErrors.revisionNotFound();

      const storedVersion = target.irJson.irVersion;
      const ir = liftV1(target.irJson);
      return {
        documentId,
        revisionId: target.revisionId,
        revisionNo: target.revisionNo,
        irHash: target.irHash,
        origin: target.origin,
        checkpointLabel: target.checkpointLabel,
        headRevisionId: head.revisionId,
        headRevisionNo: head.revisionNo,
        irVersion: ir.irVersion,
        liftedFromV1: storedVersion === '1',
        ir,
        createdBy: target.createdBy,
        createdAt: iso(target.createdAt),
      };
    });
  }

  /** UNE-DOC-007. 버전이력(US-PLAN-020 #3): 작성자·시각·요약·출처·라벨. */
  async listRevisions(
    auth: AuthContext,
    documentId: string,
    page: number,
    size: number,
  ): Promise<RevisionPage> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const document = await this.repo.findDocument(c, auth.tenantId, documentId);
      if (!document) throw documentErrors.documentNotFound();
      const head = (await this.repo.findHeadRevision(c, documentId)) as RevisionSummaryRow | null;
      const { items, totalElements } = await this.repo.listRevisions(c, documentId, page, size);
      return {
        items: items.map((row) => toRevisionResource(row, head?.revisionNo ?? -1)),
        page,
        size,
        totalElements,
        totalPages: Math.ceil(totalElements / size),
        headRevisionId: head?.revisionId ?? null,
        headRevisionNo: head?.revisionNo ?? null,
      };
    });
  }

  /**
   * UNE-DOC-008. 복원.
   *
   * US-PLAN-020 AC-01: "복원은 과거 revision을 변경하지 않고 새 head revision을
   * 생성한다." 그래서 여기에는 어떤 `UPDATE document_revision`도 없다 — 과거
   * 리비전의 `ir_json`을 **읽어서** 새 행으로 넣는다. ChangeSet도 함께 남긴다
   * (설계 10 §3.4 UNE-DOC-008의 관련 테이블이 document_revision + change_set).
   * 연산 행은 만들지 않는다: 복원은 8종 연산 어휘로 표현되는 편집이 아니라
   * "이 시점의 문서로 되돌린다"는 한 번의 사실이고, 어휘에 없는 연산을 지어내면
   * 역연산 생성기가 전수 분기에서 실패한다.
   */
  async restoreRevision(
    auth: AuthContext,
    documentId: string,
    revisionId: string,
    expectedRevisionNo: number,
    body: { reason?: string; checkpointLabel?: string },
    meta: RequestMetaLike,
  ): Promise<RestoreResult> {
    // 충돌 판정을 **값으로** 돌려받는다: 트랜잭션 안에서 던지면 그 판정을 적은
    // 감사 행까지 함께 롤백되어, 복원 충돌만 사후 관측이 불가능해진다(적용·
    // 자동저장은 ADR-30 D8에 따라 이미 값 반환이다 — 비대칭을 없앤다).
    const outcome = await this.db.withTenant(auth.tenantId, async (c) => {
      const { document, head } = await this.loadEditContext(c, auth, documentId);
      if (head.revisionNo !== expectedRevisionNo) {
        await this.insertDocumentAudit(c, auth, meta, 'REVISION_RESTORE_CONFLICTED', documentId, {
          requestedRevisionId: revisionId,
          expectedRevisionNo,
          headRevisionId: head.revisionId,
          headRevisionNo: head.revisionNo,
        });
        return { kind: 'CONFLICT' as const, state: conflictStateOf(head) };
      }
      if (document.status !== 'EDITING') {
        return {
          kind: 'REJECTED' as const,
          violations: [
            {
              field: 'document.status',
              reason: `상태가 ${document.status}인 문서는 복원할 수 없습니다(EDITING만 가능).`,
            },
          ],
        };
      }
      const source = (await this.repo.findRevision(c, documentId, revisionId, {
        withIr: true,
      })) as RevisionRow | null;
      if (!source) throw documentErrors.revisionNotFound();
      if (source.revisionId === head.revisionId) {
        throw documentErrors.unprocessable([
          { field: 'revisionId', reason: '이미 head인 Revision은 복원할 수 없습니다.' },
        ]);
      }

      // ir_json을 그대로 옮긴다. `revision` 필드만 새 리비전을 가리키게 바꾸며,
      // 그 외 값은 한 글자도 손대지 않는다 — 그래야 ir_hash가 "이 리비전이
      // 실제로 무엇을 담고 있나"에 계속 답한다.
      const restoredIr: DocumentIR = { ...source.irJson, revision: null };
      const irHash = documentIrHash(restoredIr);
      const changeSet = await this.repo.insertChangeSet(c, {
        documentId,
        baseRevisionId: head.revisionId,
        // 복원의 멱등 앵커는 (대상 리비전 × 기준 head)다. 같은 복원을 두 번
        // 보내면 두 번째는 If-Match 단계에서 먼저 409로 끝나므로, 이 값은
        // 유일성 위반을 만들지 않고 계보를 읽을 수 있게 해 준다.
        clientMutationId: `restore:${revisionId}:${head.revisionNo}`,
        selectionJson: {
          schema: 'change-set-request/1',
          selections: [],
          restoredFromRevisionId: source.revisionId,
          restoredFromRevisionNo: source.revisionNo,
        },
        status: 'APPLIED',
        origin: 'RESTORE',
        undoesChangeSetId: null,
        createdBy: auth.userId,
      });
      const revision = await this.repo.insertRevision(c, {
        documentId,
        revisionNo: head.revisionNo + 1,
        parentRevisionId: head.revisionId,
        ir: restoredIr,
        irHash,
        changeSummary: body.reason?.trim() || `Revision ${source.revisionNo} 복원`,
        origin: 'RESTORE',
        checkpointLabel: body.checkpointLabel?.trim() || null,
        createdBy: auth.userId,
      });
      await this.repo.setChangeSetResult(c, changeSet.changeSetId, revision.revisionId, documentId);
      await this.repo.setCurrentRevision(c, auth.tenantId, documentId, revision.revisionId);

      await this.insertDocumentAudit(c, auth, meta, 'REVISION_RESTORED', documentId, {
        restoredFromRevisionId: source.revisionId,
        restoredFromRevisionNo: source.revisionNo,
        newRevisionId: revision.revisionId,
        newRevisionNo: revision.revisionNo,
        changeSetId: changeSet.changeSetId,
        reason: body.reason ?? null,
      });
      await this.insertDocumentAudit(c, auth, meta, 'REVISION_SAVED', documentId, {
        revisionId: revision.revisionId,
        revisionNo: revision.revisionNo,
        origin: 'RESTORE',
        irHash,
      });
      return {
        kind: 'OK' as const,
        value: {
          revision: toRevisionResource(revision, revision.revisionNo),
          changeSetId: changeSet.changeSetId,
          restoredFromRevisionId: source.revisionId,
          restoredFromRevisionNo: source.revisionNo,
        },
      };
    });
    if (outcome.kind === 'CONFLICT') throw documentErrors.restoreConflict(outcome.state);
    if (outcome.kind === 'REJECTED') throw documentErrors.unprocessable(outcome.violations);
    return outcome.value;
  }

  /** 편집 트랜잭션 진입: 문서 잠금 → head 확보. 두 단계가 갈라지면 동시성
   * 보장이 사라지므로 항상 함께 실행한다. */
  async loadEditContext(
    client: PoolClient,
    auth: AuthContext,
    documentId: string,
  ): Promise<EditContext> {
    const document = await this.repo.findDocument(client, auth.tenantId, documentId, {
      forUpdate: true,
    });
    if (!document) throw documentErrors.documentNotFound();
    const head = (await this.repo.findHeadRevision(client, documentId, {
      withIr: true,
    })) as RevisionRow | null;
    if (!head) throw documentErrors.revisionNotFound();
    return { document, head };
  }

  async insertDocumentAudit(
    client: PoolClient,
    auth: AuthContext,
    meta: RequestMetaLike,
    action: string,
    documentId: string,
    detail: Record<string, unknown>,
    before?: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.insertAudit(client, {
      tenantId: auth.tenantId,
      actorId: auth.userId,
      action,
      resourceType: 'DOCUMENT',
      resourceId: documentId,
      correlationId: meta.correlationId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      before,
      detail,
    });
  }
}
