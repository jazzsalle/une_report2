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
import {
  preservationSave,
  type PreservationSaveInput,
  type PreservationSaveResult,
} from './serialize/preservation-save';

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
  /**
   * AC1~AC4 — 편집 결과를 원본 HWPX 구조 위에 되쓰고 Track A로 검증한다.
   *
   * CC-140이 남긴 서명은 `(documentId, outputPath) => Promise<void>`였다.
   * CC-160에서 **바이트 입출력으로 바꾼다**(ADR-31): 엔진이 문서 ID를 알면
   * DB를 알아야 하고, 파일 경로를 알면 저장소를 알아야 한다. 둘 다 엔진
   * 경계 밖이며(.claude/rules/architecture.md), 저장 위치는 저장소 포트가
   * 정한다. 엔진은 바이트를 받아 검증된 바이트를 돌려줄 뿐이다.
   */
  serialize(input: PreservationSaveInput): PreservationSaveResult;
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

  serialize(input: PreservationSaveInput): PreservationSaveResult {
    return preservationSave(input);
  }
}

/*
 * `NotYetImplementedHwpxEngine`과 `SERIALIZE_NOT_IMPLEMENTED`는 CC-160에서
 * 제거했다. 직렬화가 실제로 구현된 뒤에도 "아직 안 됨" 스텁을 남겨 두면
 * 그것을 주입한 코드가 조용히 실패하는 경로가 생긴다 — 미구현을 표현하던
 * 자리표시자의 수명은 구현이 도착하는 시점까지다(ADR-31).
 */
