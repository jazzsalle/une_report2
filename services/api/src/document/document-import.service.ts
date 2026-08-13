import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Inject, Injectable } from '@nestjs/common';
import { canonicalHash, documentIrHash, type DocumentIR, type TemplateProfile } from '@une/domain';
import { HwpxEngine } from '@une/hwpx-engine';
import {
  ObjectStorageError,
  sha256Of,
  sourceObjectKey,
  type ObjectStoragePort,
} from '@une/provider-adapters';
import { AuditRepository } from '../common/audit.repository';
import { OBJECT_STORAGE } from '../common/storage.provider';
import type { RequestMetaLike } from '../common/controller-utils';
import type { AuthContext } from '../common/request-context';
import { DatabaseService } from '../db/database.service';
import { PlanRepository } from '../plan/plan.repository';
import { DocumentRepository } from './document.repository';
import { fileErrors } from './file-errors';
import { FileRepository } from './file.repository';

/**
 * DocumentImportService — HWPX 반입 (UNE-DOC-003/004).
 *
 * CC-160까지 이 서비스에는 HTTP 표면이 없었다(ADR-31 D1이 업로드 API를 범위
 * 밖에 두었다). CC-170이 그 표면을 붙인다: 사전등록·전송·완료확정을 지난
 * `file_object`를 받아 문서를 만들고, 분석 결과를 조회할 수 있게 한다.
 *
 * 쓰는 것은 네 가지다.
 *   * `document`               — 애그리거트 루트
 *   * `document_revision` #1   — `origin = 'IMPORT'` (0019 §2.1)
 *   * `template_profile`       — 분석 결과. `style_prototype`은 그 하위 행이며,
 *                                UNE-DOC-004의 `x-db-tables`가 가리키는 실제
 *                                테이블 이름이다(설계의 `prototype_registry`는
 *                                구현에 존재하지 않는다 — 이름 드리프트 종결).
 *   * `plan.document_id`       — 요청에 planId가 있을 때. 0003부터 있던 컬럼이고
 *                                FK도 있었지만 **쓰는 코드가 없었다**(CC-170).
 *
 * 분석은 동기다. 실문서 6종이 수십 ms이므로 Job으로 만들면 관리 대상만
 * 늘어나고 사용자가 기다리는 시간은 같다(ADR-32).
 */

export interface ImportResult {
  documentId: string;
  revisionId: string;
  revisionNo: number;
  irHash: string;
  templateProfileId: string;
  prototypeCount: number;
  verdict: string;
  elapsedMs: number;
}

/** 계약 DocumentAnalysisSummary. */
export interface DocumentAnalysisSummary {
  templateProfileId: string;
  profileVersion: number;
  verdict: string;
  confidence: number;
  objectCounts: Record<string, number>;
  prototypeCount: number;
  unsupportedObjectCount: number;
  warnings: string[];
  analysisHash: string;
  elapsedMs?: number;
}

/** 계약 ImportedDocumentResource. */
export interface ImportedDocumentResource {
  documentId: string;
  planId: string | null;
  title: string;
  documentType: string;
  status: string;
  sourceFileId: string;
  revisionId: string;
  revisionNo: number;
  irHash: string;
  analysis: DocumentAnalysisSummary;
}

/** 계약 DocumentAnalysisResource. */
export interface DocumentAnalysisResource {
  documentId: string;
  analysis: DocumentAnalysisSummary;
  unsupportedObjects: unknown[];
  profile: unknown;
  createdAt: string;
}

/** TemplateProfile.compatibility.verdict → template_profile.analysis_status.
 * ADR-31 D12가 이 컬럼을 **판정 축**으로 확정했고(0020 §5가 CHECK를 건다)
 * 판정 어휘를 그대로 쓴다 — 변환하지 않는다. 설계 09의 생명주기 어휘는
 * 직교하는 다른 축이며 화면 구현 시점에 별도 컬럼으로 선다. */
function analysisStatusOf(verdict: string): string {
  return verdict;
}

/**
 * 저장된 template_profile 행 → 계약 요약.
 *
 * 판정·신뢰도·객체 등급 집계는 `profile_json`의 compatibility에서 온다.
 * `analysis_status` 컬럼과 `compatibility.verdict`는 같은 값이며(ADR-31 D12),
 * 둘이 갈라졌다면 그것은 결함이므로 컬럼 쪽을 신고한다.
 */
function toAnalysisSummary(detail: {
  templateProfileId: string;
  profileVersion: number;
  analysisStatus: string;
  profile: TemplateProfile;
  unsupportedObjects: unknown[];
  analysisHash: string;
}): DocumentAnalysisSummary {
  const compatibility = detail.profile.compatibility;
  return {
    templateProfileId: detail.templateProfileId,
    profileVersion: detail.profileVersion,
    verdict: detail.analysisStatus,
    confidence: compatibility.confidence,
    objectCounts: { ...compatibility.objectCounts },
    prototypeCount: detail.profile.prototypes.length,
    unsupportedObjectCount: detail.unsupportedObjects.length,
    warnings: [...detail.profile.warnings],
    analysisHash: detail.analysisHash,
  };
}

@Injectable()
export class DocumentImportService {
  private readonly engine = new HwpxEngine();

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(DocumentRepository) private readonly repo: DocumentRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(FileRepository) private readonly files: FileRepository,
    @Inject(PlanRepository) private readonly plans: PlanRepository,
  ) {}

  async importFromFile(
    auth: AuthContext,
    filePath: string,
    options: { title?: string; documentType?: string; sourceFileId?: string | null },
    meta: RequestMetaLike,
  ): Promise<ImportResult> {
    const bytes = new Uint8Array(await readFile(filePath));
    return this.importFromBytes(auth, bytes, { fileName: filePath, ...options }, meta);
  }

  /**
   * UNE-DOC-003 — 검증된 `file_object`에서 문서를 만든다.
   *
   * 전제는 하나다: 파일이 UNE-DOC-002를 통과했다(`uploadState === 'VERIFIED'`).
   * 검증되지 않은 바이트로 문서를 만들면 그 뒤의 모든 무결성 주장이 근거를
   * 잃는다 — 되쓰기는 "원본과 같은 바이트"를 전제로 하고, 그 원본이 무엇인지
   * 아무도 확인하지 않은 상태가 된다.
   */
  async importFromFileObject(
    auth: AuthContext,
    input: {
      fileId: string;
      planId?: string | null;
      title?: string;
      /**
       * 어떤 종류의 문서를 만드는가. 기본은 계획서다(UNE-DOC-003).
       *
       * CC-300이 이 문을 열었다: 상황일지도 **반입된 양식 위에서** 시작한다
       * (US-SIT-034 4단계 "원본 Template Prototype을 상속해 HWPX를 저장한다").
       * 양식 사본을 만드는 기제는 반입과 같으므로 새로 만들지 않는다 —
       * 한 파일에서 여러 문서를 만드는 것은 여기서 이미 되던 일이다.
       */
      documentType?: string;
    },
    meta: RequestMetaLike,
  ): Promise<ImportedDocumentResource> {
    const file = await this.db.withTenant(auth.tenantId, (c) =>
      this.files.find(c, auth.tenantId, input.fileId),
    );
    if (!file) throw fileErrors.notFound();
    // **그 자리에 올 파일인가** (OB-19). 지식문서용으로 올라온 바이트를 HWPX
    // 반입이 받으면 용도별 정책이 무의미해진다 — 형식 검사는 통과할 수 있다.
    if (file.purpose !== 'HWPX_IMPORT') {
      throw fileErrors.importRejected('HWPX 반입 용도로 등록된 파일이 아닙니다.', [
        { field: 'fileId', reason: `purpose=${file.purpose} — HWPX_IMPORT여야 합니다.` },
      ]);
    }
    if (file.uploadState !== 'VERIFIED') {
      throw fileErrors.importRejected('업로드 검증을 통과하지 않은 파일입니다.', [
        {
          field: 'fileId',
          reason: `uploadState=${file.uploadState} — UNE-DOC-002를 먼저 완료하십시오.`,
        },
      ]);
    }

    // 저장소 읽기는 트랜잭션 밖이다.
    let bytes: Uint8Array;
    try {
      bytes = (await this.storage.get(file.storageKey)).body;
    } catch (error) {
      if (error instanceof ObjectStorageError && error.kind === 'NOT_FOUND') {
        throw fileErrors.importRejected('업로드된 바이트를 찾을 수 없습니다.');
      }
      throw error instanceof ObjectStorageError
        ? fileErrors.storageUnavailable()
        : (error as Error);
    }

    // 되쓰기 기준으로 삼기 전에 **바이트 자체**를 확인한다. `uploadState`는
    // 컬럼값이지 내용이 아니다 — 확정 이후에도 스테이징 객체는 이론상 다시
    // 쓰일 수 있고(전송 라우트는 PENDING 동안 재전송을 허용한다), Export 워커가
    // 같은 비교를 이미 한다(CC-160 리뷰 M-6). 문서와 IR을 만드는 쪽이 확인하지
    // 않는 비대칭은 근거가 없다(CC-170 리뷰 M-1).
    if (sha256Of(bytes) !== file.sha256) {
      throw fileErrors.importRejected('저장된 바이트가 등록된 해시와 다릅니다.', [
        { field: 'fileId', reason: '파일을 다시 업로드하십시오.' },
      ]);
    }

    const result = await this.importFromBytes(
      auth,
      bytes,
      {
        fileName: file.originalName,
        title: input.title,
        sourceFileId: file.fileId,
        planId: input.planId ?? null,
        documentType: input.documentType,
      },
      meta,
    );

    const detail = await this.db.withTenant(auth.tenantId, (c) =>
      this.repo.findTemplateProfileDetail(c, result.documentId),
    );
    if (!detail) throw fileErrors.analysisNotFound();

    return {
      documentId: result.documentId,
      planId: input.planId ?? null,
      title: input.title ?? file.originalName,
      documentType: input.documentType ?? 'PLAN',
      status: 'EDITING',
      sourceFileId: file.fileId,
      revisionId: result.revisionId,
      revisionNo: result.revisionNo,
      irHash: result.irHash,
      analysis: { ...toAnalysisSummary(detail), elapsedMs: result.elapsedMs },
    };
  }

  /** UNE-DOC-004 — 저장된 분석 결과. 다시 분석하지 않는다. */
  async getAnalysis(auth: AuthContext, documentId: string): Promise<DocumentAnalysisResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const document = await this.repo.findDocument(c, auth.tenantId, documentId);
      if (!document) throw fileErrors.analysisNotFound();
      const detail = await this.repo.findTemplateProfileDetail(c, documentId);
      if (!detail) throw fileErrors.analysisNotFound();
      return {
        documentId,
        analysis: toAnalysisSummary(detail),
        unsupportedObjects: detail.unsupportedObjects,
        profile: detail.profile,
        createdAt: detail.createdAt.toISOString(),
      };
    });
  }

  async importFromBytes(
    auth: AuthContext,
    bytes: Uint8Array,
    options: {
      fileName?: string;
      title?: string;
      documentType?: string;
      sourceFileId?: string | null;
      /** 주면 같은 트랜잭션에서 `plan.document_id`에 붙인다. */
      planId?: string | null;
    },
    meta: RequestMetaLike,
  ): Promise<ImportResult> {
    // 분석은 CPU 작업이며 DB를 모른다 — 트랜잭션 **밖**에서 끝낸다
    // (.claude/rules/backend.md "외부/장시간 작업은 긴 트랜잭션 밖").
    const analysis = this.engine.analyzeDocument({ bytes, fileName: options.fileName });

    // CC-160: 원본 바이트를 저장소에 등록한다. 이것이 없으면 document의
    // source_file_id가 영원히 NULL이고 **보존 Export가 성립하지 않는다** —
    // 되쓰기는 원본 패키지 위에서 하는 일이기 때문이다(ADR-30이 이 배선을
    // CC-160에 배정했다). 업로드도 I/O이므로 트랜잭션 밖에서 끝낸다.
    const sourceFileId =
      options.sourceFileId ?? (await this.registerSource(auth, bytes, options.fileName));

    return this.db.withTenant(auth.tenantId, async (c) => {
      // 계획서를 먼저 확인한다. 링크가 실패할 요청이라면 문서를 만들지 않는
      // 것이 옳다 — 한 트랜잭션이므로 뒤에서 던져도 되돌아가지만, 문서 번호와
      // 저장소 객체를 낭비하지 않는다.
      if (options.planId) {
        const plan = await this.plans.findPlan(c, auth.tenantId, options.planId, {
          forUpdate: true,
        });
        if (!plan || plan.deletedAt) throw fileErrors.planNotFound();
      }

      const document = await this.repo.insertDocument(c, {
        tenantId: auth.tenantId,
        documentType: options.documentType ?? 'PLAN',
        title: options.title ?? options.fileName?.split(/[\\/]/).pop() ?? '가져온 문서',
        sourceFileId,
        status: 'EDITING',
        ownerId: auth.userId,
      });

      if (options.planId) {
        const attached = await this.plans.attachDocument(
          c,
          auth.tenantId,
          options.planId,
          document.documentId,
        );
        if (!attached) throw fileErrors.planAlreadyHasDocument();
      }

      // IR의 documentId는 DB의 문서 식별자와 같아야 한다. 엔진은 DB를 모르므로
      // 여기서 한 번 묶는다 — 그리고 그 상태의 해시를 저장한다(값과 해시가
      // 어긋나면 ir_hash가 "무엇이 저장됐나"에 답하지 못한다).
      const ir: DocumentIR = { ...analysis.ir, documentId: document.documentId, revision: null };
      const irHash = documentIrHash(ir);
      const revision = await this.repo.insertRevision(c, {
        documentId: document.documentId,
        revisionNo: 1,
        parentRevisionId: null,
        ir,
        irHash,
        changeSummary: 'HWPX 가져오기',
        origin: 'IMPORT',
        checkpointLabel: '생성전',
        createdBy: auth.userId,
      });
      await this.repo.setCurrentRevision(
        c,
        auth.tenantId,
        document.documentId,
        revision.revisionId,
      );

      const templateProfileId = await this.repo.insertTemplateProfile(c, {
        documentId: document.documentId,
        profileVersion: 1,
        analysisStatus: analysisStatusOf(analysis.profile.compatibility.verdict),
        profile: analysis.profile,
        unsupportedObjects: analysis.profile.compatibility.objects.filter(
          (object) => object.objectClass !== 'NATIVE_EDIT',
        ),
        analysisHash: createHash('sha256')
          .update(canonicalHash(analysis.profile), 'utf8')
          .digest('hex'),
      });
      for (const prototype of analysis.profile.prototypes) {
        await this.repo.insertStylePrototype(c, {
          templateProfileId,
          prototypeKey: prototype.prototypeId,
          prototypeType: prototype.tableContext ? 'TABLE' : 'PARAGRAPH',
          sourceLocator: {
            rawXmlAnchor: prototype.rawXmlAnchor,
            sourceParagraphId: prototype.sourceParagraphId,
            sourceTableId: prototype.sourceTableId,
          },
          clonePolicy: {
            clonePolicy: prototype.clonePolicy,
            prefixPolicy: prototype.prefixPolicy,
            fallbackChain: prototype.fallbackChain,
            styleRole: prototype.styleRole,
            outlineLevel: prototype.outlineLevel,
          },
          styleFingerprint: canonicalHash(prototype),
        });
      }

      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: 'DOCUMENT_IMPORTED',
        resourceType: 'DOCUMENT',
        resourceId: document.documentId,
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: {
          revisionId: revision.revisionId,
          irHash,
          templateProfileId,
          verdict: analysis.profile.compatibility.verdict,
          sourceHash: analysis.profile.sourceHash,
          sourceFileId,
          planId: options.planId ?? null,
        },
      });

      return {
        documentId: document.documentId,
        revisionId: revision.revisionId,
        revisionNo: revision.revisionNo,
        irHash,
        templateProfileId,
        prototypeCount: analysis.profile.prototypes.length,
        verdict: analysis.profile.compatibility.verdict,
        elapsedMs: analysis.elapsedMs,
      };
    });
  }

  /**
   * 원본 HWPX를 저장소에 올리고 file_object로 등록한다 (CC-160).
   *
   * 키에 해시가 들어가므로 같은 파일을 다시 가져와도 같은 객체다. 반면
   * `storage_key`에는 유니크 제약이 있으므로(0003 uk_file_object_storage_key)
   * file_object 행은 **재사용**해야 한다 — 먼저 조회하고 없을 때만 넣는다.
   */
  private async registerSource(
    auth: AuthContext,
    bytes: Uint8Array,
    fileName: string | undefined,
  ): Promise<string> {
    const sha256 = sha256Of(bytes);
    const key = sourceObjectKey({ tenantId: auth.tenantId, sha256, extension: 'hwpx' });
    await this.storage.put({
      key,
      body: bytes,
      contentType: 'application/hwp+zip',
    });
    return this.db.withTenant(auth.tenantId, async (c) => {
      const existing = await c.query(`SELECT file_id FROM file_object WHERE storage_key = $1`, [
        key,
      ]);
      const found = existing.rows[0] as { file_id: string } | undefined;
      if (found) return found.file_id;
      const inserted = await c.query(
        // upload_state는 VERIFIED다. 이 경로는 **서버가 바이트를 손에 들고**
        // 해시를 계산했으므로 검증된 것이 사실이며, 0022의 백필이 기존 행에
        // 내린 판단과 같다. 기본값(PENDING)에 맡기면 그 판단과 반대되는 행이
        // 계속 쌓이고 미완료 정리 인덱스에 걸린다(리뷰 M-5).
        // purpose는 HWPX_IMPORT다 — 기본값에 맡기지 않고 적는다(OB-19). 이
        // 경로가 만드는 것은 언제나 HWPX 원본이고, 기본값은 언젠가 바뀐다.
        `INSERT INTO file_object
           (tenant_id, storage_key, original_name, mime_type, size_bytes, sha256,
            scan_status, upload_state, verified_at, purpose, created_by)
         VALUES ($1, $2, $3, 'application/hwp+zip', $4, $5, 'PENDING', 'VERIFIED', now(),
                 'HWPX_IMPORT', $6)
         RETURNING file_id`,
        [
          auth.tenantId,
          key,
          (fileName?.split(/[\\/]/).pop() ?? 'source.hwpx').slice(0, 500),
          bytes.length,
          sha256,
          auth.userId,
        ],
      );
      return inserted.rows[0].file_id as string;
    });
  }
}
