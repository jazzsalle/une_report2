import type {
  TemplateProfile,
  TemplateProfileOutlinePattern,
  TemplateProfilePrototype,
  TemplateProfileStaticRegion,
} from '@une/domain';
import type { DocumentIrBuildResult } from '../ir/ir-builder';
import type { TemplateAnalysisResult } from './template-analyzer';

/**
 * TemplateAnalyzer 결과 → `TemplateProfile` 투영 (리뷰 M-1).
 *
 * ## 왜 별도 함수인가
 *
 * `TemplateAnalysisResult`는 엔진 **내부** 산출물이다. `classification.objects`
 * 처럼 XML 트리를 들고 있는 것과 가까운 값도 있고, 필드 구성은 분석기가
 * 바뀌면 같이 바뀐다. 반면 CC-150은 이것을 `template_profile.profile_json`에
 * 넣고 몇 달 뒤에 읽는다. 두 요구를 한 타입으로 감당하면 내부 리팩터링이
 * 저장된 행을 해석 불가로 만든다. 그래서 **투영**을 명시적으로 둔다.
 *
 * ## 값 정책
 *
 * - 순서는 결정적이다. 같은 입력이면 같은 JSON이 나와야 `profile_json`의
 *   해시 비교와 회귀 골든이 성립한다. 분석기가 이미 정렬해 내보내는 것은
 *   그대로 쓰고, 그렇지 않은 것은 여기서 정렬하지 않는다(문서 순서가 의미를
 *   갖는 목록을 알파벳순으로 흩뜨리지 않기 위해서다).
 * - 배열은 전부 복사한다. 프로파일이 분석 결과의 내부 배열을 참조로 물고
 *   있으면 소비자 쪽 변형이 분석 결과를 오염시킨다.
 * - 본문 텍스트는 들어가지 않는다(security.md). `literalPrefix`·
 *   `leadingWhitespace`는 기호와 공백이며 개인정보가 아니다. `evidence`는
 *   요소 이름·속성 키·카운트만 담는다(분류기가 그렇게 만든다).
 */
export function toTemplateProfile(
  analysis: TemplateAnalysisResult,
  build: DocumentIrBuildResult,
): TemplateProfile {
  const outlinePatterns: TemplateProfileOutlinePattern[] = analysis.outlinePatterns.map(
    (pattern) => ({
      patternId: pattern.patternId,
      kind: pattern.kind,
      literalPrefix: pattern.literalPrefix,
      leadingWhitespace: pattern.leadingWhitespace,
      trailingWhitespace: pattern.trailingWhitespace,
      indent: { marginLeft: pattern.indent.marginLeft, marginIntent: pattern.indent.marginIntent },
      paraPrIds: [...pattern.paraPrIds],
      outlineLevel: pattern.outlineLevel,
      occurrences: pattern.occurrences,
      firstDocumentOrder: pattern.firstDocumentOrder,
      transitions: pattern.transitions.map((transition) => ({
        toPatternId: transition.toPatternId,
        count: transition.count,
      })),
      confirmRequired: pattern.confirmRequired,
      conflicts: [...pattern.conflicts],
    }),
  );

  const prototypes: TemplateProfilePrototype[] = analysis.prototypes.map((prototype) => ({
    prototypeId: prototype.prototypeId,
    styleRole: prototype.styleRole,
    outlineLevel: prototype.outlineLevel,
    tableContext: prototype.tableContext,
    clonePolicy: prototype.clonePolicy,
    prefixPolicy: prototype.prefixPolicy,
    fallbackChain: [...prototype.fallbackChain],
    sourceParagraphId: prototype.sourceParagraphId,
    sourceTableId: prototype.sourceTableId,
    rawXmlAnchor: prototype.rawXmlAnchor,
    immutable: true,
    evidence: prototype.evidence,
  }));

  const staticRegions: TemplateProfileStaticRegion[] = analysis.staticRegions.map((region) => ({
    regionId: region.regionId,
    kind: region.kind,
    locator: region.locator,
    evidence: region.evidence,
  }));

  const classification = analysis.compatibility.classification;
  return {
    profileVersion: '1',
    // 분석 대상 바이트의 해시. IR과 같은 값을 쓰므로 프로파일과 개정이 같은
    // 입력에서 나왔음을 나중에도 대조할 수 있다.
    sourceHash: build.ir.sourceHash,
    compatibility: {
      verdict: analysis.compatibility.verdict,
      confidence: analysis.compatibility.confidence,
      components: { ...analysis.compatibility.components },
      confidenceBasis: { ...analysis.compatibility.confidenceBasis },
      objectCounts: { ...analysis.compatibility.objectCounts },
      // G15-1 "판정과 근거 재현"의 본체. 판정만 저장하면 몇 달 뒤 "왜
      // LIMITED였나"에 답할 수 없고, 그때 원본이 남아 있으리라는 보장도 없다.
      objects: classification.objects.map((object) => ({ ...object.classification })),
      unclassifiedElements: classification.unclassifiedElements.map((element) => ({ ...element })),
    },
    outlinePatterns,
    prototypes,
    staticRegions,
    warnings: [...analysis.warnings],
  };
}
