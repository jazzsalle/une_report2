import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Inject, Injectable } from '@nestjs/common';
import { canonicalHash, documentIrHash, type DocumentIR } from '@une/domain';
import { HwpxEngine } from '@une/hwpx-engine';
import { sha256Of, sourceObjectKey, type ObjectStoragePort } from '@une/provider-adapters';
import { AuditRepository } from '../common/audit.repository';
import { OBJECT_STORAGE } from '../common/storage.provider';
import type { RequestMetaLike } from '../common/controller-utils';
import type { AuthContext } from '../common/request-context';
import { DatabaseService } from '../db/database.service';
import { DocumentRepository } from './document.repository';

/**
 * DocumentImportService — HTTP 표면이 **없는** 애플리케이션 서비스.
 *
 * 업로드 API(UNE-DOC-001~004: 파일 사전등록, 업로드 완료, HWPX 분석 요청,
 * 분석결과 조회)는 **아직 아무 항목도 소유하지 않는다**(ADR-31 D1이 CC-160
 * 범위에서 제외했다 — 별도 화면 흐름이다). 그렇지만 편집·Export는 전부
 * "이미 존재하는 문서"를 전제로 하므로, 문서가 존재하게 만드는 경로가 하나는
 * 있어야 한다. 이 서비스가 그 경로다 — 컨트롤러에 배선하지 않으며 계약
 * (OpenAPI)에도 나타나지 않지만, CC-160부터는 **원본 바이트를 저장소에
 * 등록하는 책임**을 함께 진다(ADR-31 D9).
 *
 * 쓰는 것은 세 가지다.
 *   * `document`               — 애그리거트 루트
 *   * `document_revision` #1   — `origin = 'IMPORT'` (0019 §2.1)
 *   * `template_profile`       — 분석 결과. `style_prototype`은 그 하위 행이며,
 *                                UNE-DOC-004의 `x-db-tables`가 가리키는 실제
 *                                테이블 이름이다(설계의 `prototype_registry`는
 *                                구현에 존재하지 않는다 — 이름 드리프트 종결).
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

/** TemplateProfile.compatibility.verdict → template_profile.analysis_status.
 * ADR-31 D12가 이 컬럼을 **판정 축**으로 확정했고(0020 §5가 CHECK를 건다)
 * 판정 어휘를 그대로 쓴다 — 변환하지 않는다. 설계 09의 생명주기 어휘는
 * 직교하는 다른 축이며 화면 구현 시점에 별도 컬럼으로 선다. */
function analysisStatusOf(verdict: string): string {
  return verdict;
}

@Injectable()
export class DocumentImportService {
  private readonly engine = new HwpxEngine();

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(DocumentRepository) private readonly repo: DocumentRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
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

  async importFromBytes(
    auth: AuthContext,
    bytes: Uint8Array,
    options: {
      fileName?: string;
      title?: string;
      documentType?: string;
      sourceFileId?: string | null;
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
      const document = await this.repo.insertDocument(c, {
        tenantId: auth.tenantId,
        documentType: options.documentType ?? 'PLAN',
        title: options.title ?? options.fileName?.split(/[\\/]/).pop() ?? '가져온 문서',
        sourceFileId,
        status: 'EDITING',
        ownerId: auth.userId,
      });

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
        `INSERT INTO file_object
           (tenant_id, storage_key, original_name, mime_type, size_bytes, sha256, scan_status, created_by)
         VALUES ($1, $2, $3, 'application/hwp+zip', $4, $5, 'PENDING', $6)
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
