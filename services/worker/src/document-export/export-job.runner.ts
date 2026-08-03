import {
  DOCUMENT_COMPATIBILITY_VERDICTS,
  type DocumentCompatibilityVerdict,
  type DocumentIR,
} from '@une/domain';
import { HwpxEngine, HwpxExportError, type PreservationSaveResult } from '@une/hwpx-engine';
import {
  ObjectStorageError,
  exportObjectKey,
  sha256Of,
  type ObjectStoragePort,
} from '@une/provider-adapters';
import type { WorkerConfig } from '../config/worker-config';
import type { WorkerDatabase } from '../db/worker-database.service';
import { insertAudit } from '../plan-jobs/job-dispatch.repository';
import {
  claimExports,
  completeExport,
  failExport,
  insertFileObject,
  insertValidationReport,
  loadExportSource,
  requestedBy,
  sweepStaleRunning,
  type ClaimedExport,
} from './export-repositories';

interface PreparedExport {
  sourceBytes: Uint8Array;
  baseIr: DocumentIR;
  editedIr: DocumentIR;
  verdict: DocumentCompatibilityVerdict;
  unsupportedObjects: unknown;
  actorId: string;
}

export interface ExportRunSummary {
  claimed: number;
  completed: number;
  failed: number;
  skipped: number;
}

/**
 * Export 실행 (설계 07 §1.10-5, CC-160).
 *
 *   tx A (디스패치, 테넌트 없음): QUEUED -> RUNNING 클레임 + 리스 회수
 *   —— 저장소 I/O와 되쓰기는 트랜잭션 **밖에서** ——
 *   tx B (테넌트): file_object + validation_report + export_job 종단 상태를
 *                  **한 트랜잭션**으로 쓴다(CLAUDE.md의 원자성 규칙).
 *
 * 순서가 이 모양인 이유는 backend.md의 "External calls run outside long
 * database transactions" 때문이다. HWPX 되쓰기는 초 단위가 될 수 있고,
 * 그동안 트랜잭션을 열어 두면 RLS가 걸린 커넥션을 붙잡는다.
 *
 * `runOnce()`는 타이머가 없다 — 테스트가 결정적으로 구동하고, 운영 루프는
 * PlanJobPoller가 붙인다(CC-130이 세운 규약).
 */
export class ExportJobRunner {
  private readonly engine = new HwpxEngine();

  constructor(
    private readonly db: WorkerDatabase,
    private readonly storage: ObjectStoragePort,
    private readonly config: WorkerConfig,
  ) {}

  async runOnce(): Promise<ExportRunSummary> {
    const summary: ExportRunSummary = { claimed: 0, completed: 0, failed: 0, skipped: 0 };

    const claimed = await this.db.withDispatchScope(async (client) => {
      const fresh = await claimExports(client, this.config.batchSize);
      const stale = await sweepStaleRunning(
        client,
        this.config.leaseTimeoutMs,
        this.config.batchSize,
        this.config.maxAttempts,
      );
      // 같은 Job이 양쪽에 잡히지 않게 한다(방금 집은 것은 stale 조건에
      // 걸리지 않지만, 조건이 바뀌어도 중복 처리되지 않도록 좁힌다).
      const seen = new Set(fresh.map((job) => job.exportId));
      return [...fresh, ...stale.filter((job) => !seen.has(job.exportId))];
    });

    summary.claimed = claimed.length;
    for (const job of claimed) {
      // Job 단위 격리 (리뷰 M-2). 한 건의 예외가 밖으로 나가면 같은 배치의
      // 나머지는 처리되지 않은 채 RUNNING으로 남고, 폴러는 백오프만 늘린다
      // (content-job.runner.ts가 이미 쓰는 규약).
      let settled: 'COMPLETED' | 'FAILED' | 'SKIPPED';
      try {
        settled = await this.process(job);
      } catch (error) {
        console.error(
          `[une-worker] export ${job.exportId} 처리 실패: ${error instanceof Error ? error.message : error}`,
        );
        settled = 'FAILED';
      }
      if (settled === 'COMPLETED') summary.completed += 1;
      else if (settled === 'FAILED') summary.failed += 1;
      else summary.skipped += 1;
    }
    return summary;
  }

  private async process(job: ClaimedExport): Promise<'COMPLETED' | 'FAILED' | 'SKIPPED'> {
    let prepared: PreparedExport;

    try {
      prepared = await this.load(job);
    } catch (error) {
      return this.settleFailure(job, null, error);
    }

    let result: PreservationSaveResult;
    try {
      result = this.engine.serialize({
        sourceBytes: prepared.sourceBytes,
        baseIr: prepared.baseIr,
        editedIr: prepared.editedIr,
        mode: 'SAVE_AS',
        verdict: prepared.verdict,
        // 권위 있는 분류 결과(template_profile.unsupported_objects_json)를
        // 먼저 본다. IR의 보존 블록 등급만 보면 JSON 왕복에서 등급이 빠진
        // 리비전이 조용히 "FLATTEN 없음"이 된다(리뷰 M-3). 둘 중 하나라도
        // FLATTEN_EXPORT_ONLY를 말하면 막는다.
        hasFlattenExportOnlyObject:
          hasFlattenOnlyInClassification(prepared.unsupportedObjects) ||
          hasFlattenOnly(prepared.editedIr),
      });
    } catch (error) {
      // 저장 차단(HWPX-1104)과 검증 실패(HWPX-1105)는 사용자에게 보여야 할
      // 사유다. 보고서를 남기고 FAILED로 정산한다.
      return this.settleFailure(job, prepared.actorId, error);
    }

    const key = exportObjectKey({
      tenantId: job.tenantId,
      exportId: job.exportId,
      sha256: result.outputSha256,
      extension: 'hwpx',
    });

    try {
      await this.storage.put({
        key,
        body: result.outputBytes,
        contentType: 'application/hwp+zip',
        metadata: { exportId: job.exportId, documentId: job.documentId },
      });
    } catch (error) {
      return this.settleFailure(job, prepared.actorId, error);
    }

    // 검증을 통과한 산출물만 여기 도달한다(엔진이 FAIL이면 던진다).
    return this.db.withTenant(job.tenantId, async (client) => {
      const reportId = await insertValidationReport(client, {
        targetType: 'EXPORT',
        targetId: job.exportId,
        track: 'A_AUTO',
        status: result.report.status,
        checks: result.report.checks,
        environment: {
          notRunLayers: result.report.notRunLayers,
          outputSha256: result.report.outputSha256,
          sourceSha256: result.report.sourceSha256,
          replacedParts: result.replacedParts,
          spliceCount: result.spliceCount,
          noOp: result.noOp,
          engine: 'une-hwpx-engine',
        },
      });
      const fileId = await insertFileObject(client, {
        tenantId: job.tenantId,
        storageKey: key,
        originalName: `${job.documentId}.hwpx`,
        mimeType: 'application/hwp+zip',
        sizeBytes: result.outputBytes.length,
        sha256: result.outputSha256,
        createdBy: prepared.actorId,
      });
      const updated = await completeExport(client, {
        exportId: job.exportId,
        outputFileId: fileId,
        validationReportId: reportId,
      });
      if (updated === 0) return 'SKIPPED' as const;

      await insertAudit(client, {
        tenantId: job.tenantId,
        actorId: prepared.actorId,
        action: 'EXPORT_COMPLETED',
        resourceType: 'DOCUMENT',
        resourceId: job.documentId,
        correlationId: `export:${job.exportId}`,
        detail: {
          exportId: job.exportId,
          fileId,
          validationReportId: reportId,
          validationStatus: result.report.status,
          outputSha256: result.outputSha256,
          noOp: result.noOp,
        },
      });
      return 'COMPLETED' as const;
    });
  }

  private async load(job: ClaimedExport): Promise<PreparedExport> {
    const loaded = await this.db.withTenant(job.tenantId, async (client) => {
      const source = await loadExportSource(client, job.documentId, job.revisionId);
      const actorId = await requestedBy(client, job.exportId);
      return { source, actorId };
    });
    if (!loaded.source) throw new Error('문서 또는 Revision을 찾을 수 없습니다');
    if (!loaded.source.sourceStorageKey) {
      throw new Error('원본 HWPX가 없어 보존 저장을 할 수 없습니다');
    }
    if (!loaded.actorId) throw new Error('Export 요청자를 찾을 수 없습니다');

    // 호환성 판정이 없으면 **막는다**(리뷰 M-3). 기본값을 두면 저장 차단
    // 집행(ADR-29 D11)의 입력이 "허용"이 되어, 판정을 못 얻은 문서가 조용히
    // 통과한다. 어휘 밖의 값도 같다 — 모르는 등급은 통과시킬 근거가 없다.
    const verdict = loaded.source.verdict;
    if (verdict === null || !DOCUMENT_COMPATIBILITY_VERDICTS.includes(verdict as never)) {
      throw new Error(
        `호환성 판정을 확인할 수 없어 저장을 중단합니다 (analysis_status=${verdict ?? 'NULL'})`,
      );
    }

    const fetched = await this.storage.get(loaded.source.sourceStorageKey);

    // 저장소에서 받은 바이트가 file_object에 등록된 그 바이트인가 (리뷰 M-6).
    // 다운로드 경로는 이 비교를 이미 한다 — 사용자에게 내줄 때는 확인하고
    // 되쓰기의 **기준**으로 삼을 때는 확인하지 않는 비대칭은 근거가 없다.
    if (loaded.source.sourceSha256 && sha256Of(fetched.body) !== loaded.source.sourceSha256) {
      throw new Error('원본 바이트가 등록된 해시와 다릅니다 (되쓰기 기준을 신뢰할 수 없음)');
    }

    return {
      sourceBytes: fetched.body,
      // 원본 IMPORT 리비전이 없으면 대상 리비전을 기준으로 쓴다 —
      // 그 경우 되쓰기 계획이 비어 no-op 저장이 된다(손상보다 안전하다).
      baseIr: (loaded.source.baseIr ?? loaded.source.revisionIr) as DocumentIR,
      editedIr: loaded.source.revisionIr as DocumentIR,
      verdict: verdict as DocumentCompatibilityVerdict,
      unsupportedObjects: loaded.source.unsupportedObjects,
      actorId: loaded.actorId,
    };
  }

  private async settleFailure(
    job: ClaimedExport,
    actorId: string | null,
    error: unknown,
  ): Promise<'FAILED' | 'SKIPPED'> {
    const detail = describe(error);
    return this.db.withTenant(job.tenantId, async (client) => {
      const resolvedActor = actorId ?? (await requestedBy(client, job.exportId));
      // 실패도 검증 보고서로 남긴다. export_job에 error_json이 없고(0020 §6),
      // 사용자에게 "왜 실패했는지"를 보여줄 자리는 이 보고서뿐이다.
      const reportId = await insertValidationReport(client, {
        targetType: 'EXPORT',
        targetId: job.exportId,
        track: 'A_AUTO',
        status: 'FAIL',
        checks: detail.checks,
        environment: { notRunLayers: [], failure: detail.code },
      });
      const updated = await failExport(client, {
        exportId: job.exportId,
        validationReportId: reportId,
      });
      if (updated === 0) return 'SKIPPED' as const;
      if (resolvedActor) {
        await insertAudit(client, {
          tenantId: job.tenantId,
          actorId: resolvedActor,
          action: 'EXPORT_FAILED',
          resourceType: 'DOCUMENT',
          resourceId: job.documentId,
          correlationId: `export:${job.exportId}`,
          detail: { exportId: job.exportId, code: detail.code, reason: detail.message },
        });
      }
      return 'FAILED' as const;
    });
  }
}

function describe(error: unknown): {
  code: string;
  message: string;
  checks: unknown[];
} {
  if (isExportError(error)) {
    return {
      code: error.code,
      message: error.detail,
      checks: [
        {
          code: error.code,
          layer: 'PACKAGE',
          outcome: 'FAIL',
          detail: error.detail,
          locator: error.locator,
        },
      ],
    };
  }
  if (error instanceof ObjectStorageError) {
    return {
      code: `STORAGE-${error.kind}`,
      message: error.message,
      checks: [{ code: 'STORAGE', layer: 'PACKAGE', outcome: 'FAIL', detail: error.message }],
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: 'EXPORT-UNKNOWN',
    message,
    checks: [{ code: 'EXPORT', layer: 'PACKAGE', outcome: 'FAIL', detail: message }],
  };
}

/**
 * `instanceof`가 워크스페이스 경계를 넘으면 신뢰할 수 없다 — 엔진과 워커가
 * 서로 다른 복사본을 로드하면 같은 클래스가 아니게 된다. 이름과 코드 모양으로
 * 판정한다(HwpxExportError는 code/locator/detail을 계약으로 노출한다).
 */
function isExportError(error: unknown): error is HwpxExportError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'HwpxExportError' &&
    typeof (error as { code?: unknown }).code === 'string'
  );
}

/**
 * 분류기가 낸 미지원 객체 목록에 FLATTEN_EXPORT_ONLY가 있는가.
 *
 * `template_profile.unsupported_objects_json`은 import가 NATIVE_EDIT가 아닌
 * 객체 전량을 넣은 배열이며, 각 항목이 `objectClass`를 갖는다. 이것이 집행의
 * **권위 있는** 입력이다(리뷰 M-3).
 */
function hasFlattenOnlyInClassification(objects: unknown): boolean {
  if (!Array.isArray(objects)) return false;
  return objects.some(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      (entry as { objectClass?: unknown }).objectClass === 'FLATTEN_EXPORT_ONLY',
  );
}

/** IR의 보존 블록 중 FLATTEN_EXPORT_ONLY 등급이 있는가 (보조 입력). */
function hasFlattenOnly(ir: DocumentIR): boolean {
  for (const section of ir.sections ?? []) {
    const stack = [...(section.blocks ?? [])];
    while (stack.length > 0) {
      const block = stack.pop();
      if (!block) continue;
      if (block.kind === 'PRESERVED') {
        if (block.classification?.objectClass === 'FLATTEN_EXPORT_ONLY') return true;
        continue;
      }
      if (block.kind === 'TABLE') {
        for (const row of block.rows ?? []) {
          for (const cell of row.cells ?? []) stack.push(...(cell.blocks ?? []));
        }
      }
    }
  }
  return false;
}
