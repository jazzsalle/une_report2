import { Inject, Injectable } from '@nestjs/common';
import {
  checkKnowledgeFile,
  checkKnowledgeRetryable,
  isEvidenceEligible,
  isScopeSelectableAtUpload,
  isSearchableWithoutReference,
  type KnowledgeDocumentStatus,
  type KnowledgeDocumentType,
  type RetentionScope,
  type UniProcessingStatus,
} from '@une/domain';
import { API_CONFIG, type ApiConfig } from '../config/api-config';
import { AuditRepository } from '../common/audit.repository';
import type { RequestMetaLike } from '../common/controller-utils';
import type { AuthContext } from '../common/request-context';
import { DatabaseService } from '../db/database.service';
import { SituationRepository } from '../situation/situation.repository';
import { knowledgeErrors } from './knowledge-errors';
import { KnowledgeRepository, type KnowledgeDocumentRow } from './knowledge.repository';

/**
 * 지식문서 등록·조회·재시도 (CC-220, UNE-KNOW-001~003).
 *
 * **UNI를 여기서 부르지 않는다.** 설계 10 §7.23 정상 Sequence 7단계가 "외부
 * 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 **Worker가** UNI를 호출한다"
 * 이다. CC-200의 상황 수집(동기)과 갈리는 지점이며, 그래서 등록은 202로 끝나고
 * 진행은 UNE-KNOW-002가 알려준다.
 *
 * 트랜잭션 경계: 문서 생성·잡 생성·감사가 한 트랜잭션이다
 * (`.claude/rules/backend.md` "State change, audit/execution event, and outbox
 * insert are atomic where defined").
 */

export interface KnowledgeDocumentResource {
  knowledgeDocumentId: string;
  situationId: string | null;
  fileId: string;
  documentType: string;
  retentionScope: string;
  /** UNE 등록 축. */
  status: KnowledgeDocumentStatus;
  /** UNI 처리 축. null은 "아직 모른다"이지 "처리되지 않았다"가 아니다. */
  uniStatus: UniProcessingStatus | null;
  uniObservedAt: string | null;
  providerDocumentId: string | null;
  /** 두 축을 합쳐 판정한 결과 — 화면이 다시 계산하지 않게 함께 싣는다. */
  evidenceEligible: boolean;
  searchable: boolean;
  sourceSha256: string | null;
  attemptCount: number;
  lastAttemptAt: string | null;
  error: unknown;
  reference: unknown;
  metadata: unknown;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateKnowledgeDocumentInput {
  fileId: string;
  documentType: string;
  retentionScope?: string;
  force?: boolean;
  metadata?: Record<string, unknown>;
}

export function toKnowledgeResource(row: KnowledgeDocumentRow): KnowledgeDocumentResource {
  const status = row.status as KnowledgeDocumentStatus;
  const uniStatus = row.uniStatus as UniProcessingStatus | null;
  return {
    knowledgeDocumentId: row.knowledgeDocumentId,
    situationId: row.situationId,
    fileId: row.fileId,
    documentType: row.documentType,
    retentionScope: row.retentionScope,
    status,
    uniStatus,
    uniObservedAt: row.uniObservedAt ? row.uniObservedAt.toISOString() : null,
    providerDocumentId: row.providerDocumentId,
    evidenceEligible: isEvidenceEligible(status, uniStatus),
    searchable: isSearchableWithoutReference(status, uniStatus),
    sourceSha256: row.sourceSha256,
    attemptCount: row.attemptCount,
    lastAttemptAt: row.lastAttemptAt ? row.lastAttemptAt.toISOString() : null,
    error: row.errorJson ?? null,
    reference: row.referenceJson ?? null,
    metadata: row.metadataJson ?? {},
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const FILE_BLOCKER_MESSAGES: Record<string, { reason: string; userAction: string }> = {
  INFECTED: {
    reason: '악성코드가 검출된 파일입니다',
    userAction: '해당 파일을 사용하지 마십시오. 보안 담당자에게 문의하십시오.',
  },
  NOT_VERIFIED: {
    reason: '업로드 검증이 완료되지 않았습니다',
    userAction: '업로드를 마치고 검증이 끝난 뒤 다시 등록하십시오.',
  },
  SCAN_PENDING: {
    reason: '악성코드 검사 결과가 아직 없습니다',
    userAction: '검사가 끝난 뒤 다시 등록하십시오. 계속되면 관리자에게 문의하십시오.',
  },
  TOO_LARGE: {
    reason: '허용 크기를 초과했습니다',
    userAction: '파일을 나누거나 용량을 줄여 다시 등록하십시오.',
  },
  MIME_NOT_ALLOWED: {
    reason: '허용되지 않은 형식입니다',
    userAction: '허용된 문서 형식으로 변환한 뒤 다시 등록하십시오.',
  },
};

/** 파일 검사 거부를 트랜잭션 밖으로 들고 나가는 내부 신호. */
class FileRejected extends Error {
  constructor(readonly blocker: string) {
    super(`file rejected: ${blocker}`);
  }
}

@Injectable()
export class KnowledgeService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(KnowledgeRepository) private readonly docs: KnowledgeRepository,
    @Inject(SituationRepository) private readonly situations: SituationRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  /** UNE-KNOW-001. 등록하고 UNI 전송 잡을 건다. UNI 호출은 워커가 한다. */
  async create(
    auth: AuthContext,
    meta: RequestMetaLike,
    situationId: string,
    input: CreateKnowledgeDocumentInput,
  ): Promise<KnowledgeDocumentResource> {
    const scope = (input.retentionScope ?? 'THIS_INCIDENT') as RetentionScope;
    if (!isScopeSelectableAtUpload(scope)) {
      // US-SIT-009 5단계 "기관 KB 자동승격 금지". 없는 승인 절차를 통과했다고
      // 적을 수는 없다.
      throw knowledgeErrors.scopeNotSelectable();
    }

    try {
      return await this.registerInTransaction(auth, meta, situationId, input, scope);
    } catch (err) {
      if (!(err instanceof FileRejected)) throw err;
      // 롤백된 트랜잭션 밖에서 거부를 기록한다.
      const m = FILE_BLOCKER_MESSAGES[err.blocker];
      await this.db.withTenant(auth.tenantId, (c) =>
        this.audit.insertAudit(c, {
          tenantId: auth.tenantId,
          actorId: auth.userId,
          // 설계 06 US-SIT-009 감사 이벤트.
          action: 'DOCUMENT_UPLOAD_REJECTED',
          resourceType: 'KNOWLEDGE_DOCUMENT',
          correlationId: meta.correlationId,
          ip: meta.ip,
          userAgent: meta.userAgent,
          detail: { fileId: input.fileId, blocker: err.blocker, situationId },
        }),
      );
      throw knowledgeErrors.fileRejected(m.reason, m.userAction);
    }
  }

  private async registerInTransaction(
    auth: AuthContext,
    meta: RequestMetaLike,
    situationId: string,
    input: CreateKnowledgeDocumentInput,
    scope: RetentionScope,
  ): Promise<KnowledgeDocumentResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const situation = await this.situations.findSituation(c, auth.tenantId, situationId);
      if (!situation) throw knowledgeErrors.notFound();

      const file = await this.docs.findFile(c, auth.tenantId, input.fileId);
      if (!file) throw knowledgeErrors.fileNotFound();

      // US-SIT-009 2단계·E-01. 도메인이 판정하고 여기서는 문구만 고른다.
      const blocker = checkKnowledgeFile(file, {
        maxSizeBytes: this.config.knowledgeMaxFileBytes,
        allowedMimeTypes: this.config.knowledgeAllowedMimeTypes,
        allowScanPending: this.config.knowledgeAllowScanPending,
      });
      if (blocker) {
        // **감사를 이 트랜잭션에 쓰지 않는다.** 여기서 던지면 트랜잭션이
        // 롤백되고 감사 행도 함께 사라진다 — US-SIT-009 E-01이 요구한
        // UPLOAD_REJECTED 기록이 남지 않는다(e2e가 실측으로 잡았다).
        // 거부 사유만 들고 나가서 별도 트랜잭션에 남긴 뒤 던진다.
        throw new FileRejected(blocker);
      }

      // US-SIT-009 A-01. 오류가 아니라 선택 지점이므로 force면 그대로 진행한다.
      if (!input.force) {
        const dup = await this.docs.findLiveDuplicate(c, auth.tenantId, file.sha256);
        if (dup) throw knowledgeErrors.duplicateSource(dup.knowledgeDocumentId);
      }

      const created = await this.docs.insert(c, {
        tenantId: auth.tenantId,
        situationId,
        fileId: input.fileId,
        documentType: input.documentType as KnowledgeDocumentType,
        retentionScope: scope,
        sourceSha256: file.sha256,
        metadata: input.metadata ?? {},
        createdBy: auth.userId,
      });

      const jobId = await this.docs.insertUploadJob(c, {
        tenantId: auth.tenantId,
        situationId,
        knowledgeDocumentId: created.knowledgeDocumentId,
        fileId: input.fileId,
        force: input.force ?? false,
        correlationId: meta.correlationId,
      });
      const withJob = await this.docs.attachJob(
        c,
        auth.tenantId,
        created.knowledgeDocumentId,
        jobId,
      );

      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: 'DOCUMENT_UPLOAD_REQUESTED',
        resourceType: 'KNOWLEDGE_DOCUMENT',
        resourceId: created.knowledgeDocumentId,
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: {
          fileId: input.fileId,
          documentType: input.documentType,
          retentionScope: scope,
          sourceSha256: file.sha256,
          providerJobId: jobId,
          force: input.force ?? false,
        },
      });

      return toKnowledgeResource(withJob);
    });
  }

  /**
   * UNE-KNOW-002. 마지막으로 **관측한** 상태를 돌려준다.
   *
   * 여기서 UNI를 부르지 않는다. 조회가 외부 호출을 하면 화면을 여는 것만으로
   * provider 부하가 생기고, UNI가 느릴 때 조회까지 함께 막힌다. 폴링은 워커의
   * 일이며(설계 08 §1.14의 2/4/8/15초) 이 API는 그 결과를 읽는다.
   */
  async get(auth: AuthContext, id: string): Promise<KnowledgeDocumentResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const row = await this.docs.findById(c, auth.tenantId, id);
      if (!row) throw knowledgeErrors.notFound();
      return toKnowledgeResource(row);
    });
  }

  /** UNE-KNOW-003. 새 전송 잡을 건다. 여기서도 UNI를 부르지 않는다. */
  async retry(
    auth: AuthContext,
    meta: RequestMetaLike,
    id: string,
    reason: string,
  ): Promise<KnowledgeDocumentResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      // 같은 문서에 두 재시도가 겹치면 UNI에 두 벌이 생긴다. 행을 잠그고 판단한다.
      const row = await this.docs.findById(c, auth.tenantId, id, { forUpdate: true });
      if (!row) throw knowledgeErrors.notFound();

      const blocker = checkKnowledgeRetryable(
        row.status as KnowledgeDocumentStatus,
        row.uniStatus as UniProcessingStatus | null,
        row.attemptCount,
        this.config.knowledgeMaxUploadAttempts,
      );
      if (blocker === 'NOT_FAILED') {
        throw knowledgeErrors.retryNotAllowed(
          '실패한 자료가 아닙니다',
          '진행 중이거나 이미 준비된 자료는 다시 보내지 않습니다. 상태를 확인하십시오.',
        );
      }
      if (blocker === 'CANCELLED') {
        throw knowledgeErrors.retryNotAllowed(
          '취소된 자료입니다',
          '취소된 자료는 재시도가 아니라 새로 등록해야 합니다.',
        );
      }
      if (blocker === 'ATTEMPTS_EXHAUSTED') {
        throw knowledgeErrors.retryNotAllowed(
          `재시도 횟수(${this.config.knowledgeMaxUploadAttempts}회)를 모두 사용했습니다`,
          '자료를 제외하고 진행하거나 관리자에게 문의하십시오.',
        );
      }

      const jobId = await this.docs.insertUploadJob(c, {
        tenantId: auth.tenantId,
        situationId: row.situationId,
        knowledgeDocumentId: row.knowledgeDocumentId,
        fileId: row.fileId,
        // 재시도는 항상 force다 — 실패한 전송이 저쪽에 문서를 남겼을 수 있고
        // (`sideEffectUncertain`), 그때 force가 없으면 UNI가 중복으로 거절한다.
        force: true,
        correlationId: meta.correlationId,
      });
      const updated = await this.docs.attachJob(c, auth.tenantId, row.knowledgeDocumentId, jobId);

      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: 'DOCUMENT_UPLOAD_RETRIED',
        resourceType: 'KNOWLEDGE_DOCUMENT',
        resourceId: row.knowledgeDocumentId,
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        before: { status: row.status, uniStatus: row.uniStatus, attemptCount: row.attemptCount },
        detail: { reason, providerJobId: jobId },
      });

      return toKnowledgeResource(updated);
    });
  }
}
