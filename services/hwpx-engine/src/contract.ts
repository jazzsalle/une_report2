import { readFile } from 'node:fs/promises';
import type { DocumentIR, HwpxObjectClass, TemplateProfile } from '@une/domain';
import { analyzeTemplate, type TemplateAnalysisResult } from './analysis/template-analyzer';
import { toTemplateProfile } from './analysis/template-profile';
import { classify, type ClassificationResult, type ClassifyInput } from './compat/classifier';
import { buildDocumentIr, type BuildIrOptions, type DocumentIrBuildResult } from './ir/ir-builder';
import {
  checkInvariants,
  reconstructEntries,
  type InvariantReport,
  type ReconstructionEntry,
} from './ir/invariants';
import { describeRhwpIntake, type RhwpIntakeReport } from './intake/rhwp-status';
import { DEFAULT_HWPX_LIMITS, type HwpxLimits } from './package/limits';
import { analyzePackage, type PackageAnalysisResult } from './package/package-analysis';

/**
 * HWPX 분석/직렬화 경계의 안정 계약.
 *
 * CC-140이 채우는 것은 **분석 방향**뿐이다: 패키지 분석(AC2), Document IR(AC3),
 * 호환성 분류(AC4). 직렬화(`serialize`)는 CC-160 소유이며 여기서 거부한다 —
 * Package Writer 없이 저장 경로를 열면 §8.4의 "FLATTEN_EXPORT_ONLY 원본 저장
 * 금지" 같은 집행 규칙이 갈 곳이 없다(ADR-29 D11).
 *
 * rhwp Rust/WASM Core는 여전히 **미반입**이다(ADR-29 D1). `describeRhwpIntake()`가
 * 그 사실을 상수로 신고한다.
 */

/** 객체 등급 유니온은 `@une/domain`이 정본이다(ADR-29 D4). 재정의하지 않는다. */
export type { HwpxObjectClass };

export interface HwpxAnalysisSummary {
  /** SHA-256 of the imported package, recorded for provenance. */
  packageSha256: string;
  objectCounts: Partial<Record<HwpxObjectClass, number>>;
}

export interface HwpxSource {
  readonly bytes: Uint8Array;
  /** 진단 표시용 이름. 신뢰하지 않는다(확장자·MIME 이중검사는 §1.12). */
  readonly fileName?: string;
}

export interface AnalyzeDocumentOptions extends BuildIrOptions {
  readonly limits?: HwpxLimits;
  /** true면 IR을 두 번 만들어 I1/I7 결정성을 실제로 확인한다(기본 true). */
  readonly verifyInvariants?: boolean;
}

export interface AnalyzeDocumentResult {
  readonly package: PackageAnalysisResult;
  readonly ir: DocumentIR;
  readonly build: DocumentIrBuildResult;
  readonly template: TemplateAnalysisResult;
  /**
   * `template`의 **외부 표현**. CC-150이 `template_profile.profile_json`에
   * 그대로 넣는 값이며 `@une/domain` 타입이라 엔진 의존이 없다(리뷰 M-1).
   * `template`은 엔진 내부 산출물이므로 저장 대상이 아니다.
   */
  readonly profile: TemplateProfile;
  readonly invariants: InvariantReport | null;
  readonly reconstruction: readonly ReconstructionEntry[];
  readonly rhwpIntake: RhwpIntakeReport;
  /** 분석 소요시간(ms). §1.12 "일반 50쪽 P95 5초" 실측 기록용. */
  readonly elapsedMs: number;
}

export interface HwpxEngineContract {
  /** Analyze an imported HWPX package and classify its objects. */
  analyze(packagePath: string): Promise<HwpxAnalysisSummary>;
  /** AC2 — ZIP/OPC 구조 분석과 SourcePreservationMap 구축. */
  analyzePackage(source: HwpxSource, limits?: HwpxLimits): PackageAnalysisResult;
  /** AC3 — Document IR 생성. */
  buildIr(analysis: PackageAnalysisResult, options?: BuildIrOptions): DocumentIrBuildResult;
  /** AC4 — 객체 분류 + 문서 판정 롤업(도메인 rollUpVerdict 호출). */
  classify(input: ClassifyInput): ClassificationResult;
  /** AC2~AC4 일괄 — 분석 API가 쓰는 진입점. */
  analyzeDocument(source: HwpxSource, options?: AnalyzeDocumentOptions): AnalyzeDocumentResult;
  /** Preservation-serialize the current document state back to HWPX. */
  serialize(documentId: string, outputPath: string): Promise<void>;
}

export class HwpxEngine implements HwpxEngineContract {
  analyzePackage(
    source: HwpxSource,
    limits: HwpxLimits = DEFAULT_HWPX_LIMITS,
  ): PackageAnalysisResult {
    return analyzePackage(source.bytes, limits);
  }

  buildIr(analysis: PackageAnalysisResult, options: BuildIrOptions = {}): DocumentIrBuildResult {
    return buildDocumentIr(analysis, options);
  }

  classify(input: ClassifyInput): ClassificationResult {
    return classify(input);
  }

  analyzeDocument(source: HwpxSource, options: AnalyzeDocumentOptions = {}): AnalyzeDocumentResult {
    const startedAt = process.hrtime.bigint();
    const packageAnalysis = this.analyzePackage(source, options.limits);
    const build = this.buildIr(packageAnalysis, options);
    const template = analyzeTemplate(packageAnalysis, build);
    const verify = options.verifyInvariants !== false;
    const invariants = verify
      ? checkInvariants({
          analysis: packageAnalysis,
          build,
          rebuild: this.buildIr(packageAnalysis, options),
        })
      : null;
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    return {
      package: packageAnalysis,
      ir: build.ir,
      build,
      template,
      profile: toTemplateProfile(template, build),
      invariants,
      reconstruction: reconstructEntries(packageAnalysis),
      rhwpIntake: describeRhwpIntake(),
      elapsedMs,
    };
  }

  async analyze(packagePath: string): Promise<HwpxAnalysisSummary> {
    const bytes = new Uint8Array(await readFile(packagePath));
    const result = this.analyzeDocument({ bytes, fileName: packagePath });
    return {
      packageSha256: result.package.archiveSha256,
      objectCounts: result.template.compatibility.objectCounts,
    };
  }

  serialize(_documentId: string, _outputPath: string): Promise<void> {
    // CC-140은 분석·IR·분류까지다. 저장은 Package Writer/Track A 검증과 함께
    // CC-160이 소유한다(ADR-29 D11).
    return Promise.reject(new Error(SERIALIZE_NOT_IMPLEMENTED));
  }
}

export const SERIALIZE_NOT_IMPLEMENTED =
  'HWPX serialization arrives with CC-160; CC-140 delivers analysis/IR/classification only';

/**
 * 의존성 주입 배선을 먼저 하기 위한 자리표시자. CC-140 이후로는 분석 경로가
 * 실제로 동작하므로 `HwpxEngine`을 쓰고, 이 클래스는 "아직 아무것도 안 되는
 * 상태"를 명시적으로 표현해야 하는 곳(예: Core 미반입 회귀 테스트)에만 남긴다.
 */
export class NotYetImplementedHwpxEngine implements Pick<HwpxEngineContract, 'serialize'> {
  serialize(): Promise<void> {
    return Promise.reject(new Error(SERIALIZE_NOT_IMPLEMENTED));
  }
}
