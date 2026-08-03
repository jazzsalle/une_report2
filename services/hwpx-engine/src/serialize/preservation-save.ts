import {
  decideSaveBlock,
  PACKAGE_PRODUCING_SAVE_MODES,
  type DocumentCompatibilityVerdict,
  type DocumentIR,
  type SaveMode,
} from '@une/domain';
import { analyzePackage, type PackageAnalysisResult } from '../package/package-analysis';
import { buildDocumentIr } from '../ir/ir-builder';
import { readZipArchive } from '../package/zip-reader';
import { runTrackA, type TrackAReport } from '../validate/track-a';
import { HwpxExportError } from './errors';
import { buildXmlDelta } from './xml-delta';
import { rewriteArchive } from './zip-writer';

/**
 * 보존 저장 (설계 07 §1.10-5).
 *
 * 설계의 순서는 "임시 HWPX 생성 → 구조검증 → 원자적 rename"이다. 이 함수는
 * 그 중 앞의 둘을 담당하고, **검증을 통과하지 못한 바이트는 돌려주지 않는다**.
 * 파일 시스템의 rename에 해당하는 원자성은 호출자(저장소 포트 + DB 트랜잭션)의
 * 몫이지만, 그 앞단에서 "검증 안 된 산출물이 존재할 수 있는 시간"을 없애는
 * 것은 여기서 할 수 있고 해야 한다.
 */

export interface PreservationSaveInput {
  /** 원본 HWPX 바이트. */
  readonly sourceBytes: Uint8Array;
  /** 원본에서 만든 IR(편집 전). */
  readonly baseIr: DocumentIR;
  /** 편집 결과 IR. `baseIr`과 같으면 no-op 저장이 된다. */
  readonly editedIr: DocumentIR;
  readonly mode: SaveMode;
  /** 문서 호환성 판정 — 저장 차단 집행의 입력(ADR-29 D11). */
  readonly verdict: DocumentCompatibilityVerdict;
  readonly hasFlattenExportOnlyObject: boolean;
}

export interface PreservationSaveResult {
  readonly outputBytes: Uint8Array;
  readonly outputSha256: string;
  readonly sourceSha256: string;
  readonly report: TrackAReport;
  readonly replacedParts: readonly string[];
  readonly spliceCount: number;
  /** 되쓸 것이 없었다 = 산출물이 원본과 바이트 동일하다. */
  readonly noOp: boolean;
}

export function preservationSave(input: PreservationSaveInput): PreservationSaveResult {
  if (!PACKAGE_PRODUCING_SAVE_MODES.has(input.mode)) {
    throw new HwpxExportError(
      'HWPX-1102',
      input.mode,
      'AUTOSAVE_IR은 HWPX를 만들지 않습니다 (CC-150 자동저장 경로)',
    );
  }

  // 1) 저장 차단 집행 — 되쓰기를 시작하기 전에 본다. 만들고 나서 버리면
  //    금지된 산출물이 잠깐이라도 존재하게 된다.
  const block = decideSaveBlock({
    verdict: input.verdict,
    hasFlattenExportOnlyObject: input.hasFlattenExportOnlyObject,
    mode: input.mode,
  });
  if (block.blocked) {
    throw new HwpxExportError('HWPX-1104', input.mode, block.reason ?? '저장이 차단되었습니다');
  }

  const original = analyzePackage(input.sourceBytes);
  const archive = original.archive;
  const partBytes = new Map(archive.entries.map((entry) => [entry.path, entry.bytes]));

  // 2) 되쓰기 계획 — 편집이 없으면 계획이 비고, 출력은 원본과 바이트 동일해진다.
  const delta = buildXmlDelta({
    baseIr: input.baseIr,
    editedIr: input.editedIr,
    partBytes,
  });

  const written = rewriteArchive(archive, delta.replacements);

  // 3) 산출물을 **처음 보는 문서처럼** 다시 읽는다.
  const outputAnalysis: PackageAnalysisResult = analyzePackage(written.bytes);
  const outputIr = buildDocumentIr(outputAnalysis).ir;

  const report = runTrackA({
    original,
    baseIr: input.baseIr,
    editedIr: input.editedIr,
    outputBytes: written.bytes,
    replacedParts: written.replacedPaths,
    outputAnalysis,
    outputIr,
  });

  // 4) FAIL이면 바이트를 돌려주지 않는다. LIMITED는 통과시키되 보고서에 남는다
  //    — 설계 §1.11의 합격 기준은 '치명오류 0'이고, WARN은 치명이 아니다.
  if (report.status === 'FAIL') {
    const failed = report.checks.filter((check) => check.outcome === 'FAIL');
    throw new HwpxExportError(
      'HWPX-1105',
      failed[0]?.locator ?? '(document)',
      `Track A 검증 실패로 산출물을 폐기했습니다: ${failed.map((c) => `${c.code} ${c.detail}`).join(' | ')}`,
    );
  }

  return {
    outputBytes: written.bytes,
    outputSha256: written.sha256,
    sourceSha256: original.archiveSha256,
    report,
    replacedParts: written.replacedPaths,
    spliceCount: delta.spliceCount,
    noOp: delta.spliceCount === 0,
  };
}

/** 진단용 — 산출물이 원본과 바이트 동일한지 직접 확인한다. */
export function isByteIdentical(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
}

export { readZipArchive };
