import { CONFIDENCE_WEIGHTS, computeConfidence, type ConfidenceComponents } from '@une/domain';
import type { ParagraphSource } from '../ir/ir-builder';
import type { OutlineAnalysis } from './outline-pattern';
import { paragraphText } from './outline-pattern';
import type { StaticRegion } from './static-region';
import type { StyleCluster } from './style-signature';

/**
 * confidence 6개 **성분 산출** (설계 07 §1.5 수식).
 *
 * 가중치와 임계(0.85/0.60)는 `@une/domain`이 정본이다 — 여기서 재정의하지
 * 않고 `computeConfidence`를 호출만 한다(ADR-29 D4). 엔진의 책임은
 * "각 성분을 무엇으로 세는가"뿐이고, 그 정의를 아래에 명시한다. 성분 정의가
 * 코드에만 있고 문장으로 없으면 판정 근거를 재현할 수 없다(G15-1).
 */

export interface ConfidenceEvidence {
  readonly components: ConfidenceComponents;
  readonly value: number;
  /** 성분별 "무엇을 셌는가". 판정 근거 재현용. */
  readonly basis: Readonly<Record<keyof ConfidenceComponents, string>>;
}

/** 의미 힌트 사전 — 재난 보고 양식의 절 제목 어휘(§1.5-2 규칙 기반 1차 분류). */
const SEMANTIC_KEYWORDS = [
  '개요',
  '현황',
  '피해',
  '조치',
  '계획',
  '대책',
  '보고',
  '결과',
  '총괄',
  '경과',
  '전망',
  '조치사항',
  '향후',
  '붙임',
];
const SEMANTIC_TARGET = 4;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export interface ConfidenceInput {
  readonly paragraphs: readonly ParagraphSource[];
  readonly clusters: readonly StyleCluster[];
  readonly outline: OutlineAnalysis;
  readonly staticRegions: readonly StaticRegion[];
}

export function computeConfidenceEvidence(input: ConfidenceInput): ConfidenceEvidence {
  const paragraphCount = input.paragraphs.length;

  // styleConsistency — 서로 다른 Signature가 적을수록 양식이 규칙적이다.
  // 모든 문단이 한 Signature면 1, 전부 제각각이면 0.
  const distinct = input.clusters.length;
  const styleConsistency =
    paragraphCount <= 1 ? 0 : clamp01(1 - (distinct - 1) / (paragraphCount - 1));

  // prefixConsistency — 문자형 접두사를 가진 문단 중 **2회 이상 반복되는**
  // 패턴에 속한 비율. 접두사가 하나도 없으면 근거가 없으므로 0이다
  // (중립값을 주면 근거 없는 문서가 AUTO로 올라간다).
  const prefixPatterns = input.outline.patterns.filter(
    (pattern) => pattern.kind === 'LITERAL_PREFIX',
  );
  const prefixed = prefixPatterns.reduce((sum, pattern) => sum + pattern.occurrences, 0);
  const repeatedPrefixed = prefixPatterns
    .filter((pattern) => pattern.occurrences >= 2)
    .reduce((sum, pattern) => sum + pattern.occurrences, 0);
  const prefixConsistency = prefixed === 0 ? 0 : clamp01(repeatedPrefixed / prefixed);

  // indentHierarchy — level이 올라갈수록 들여쓰기가 단조 증가하는 인접 쌍 비율.
  const byLevel = [...input.outline.patterns].sort((a, b) => a.outlineLevel - b.outlineLevel);
  let pairs = 0;
  let monotonic = 0;
  for (let i = 0; i + 1 < byLevel.length; i += 1) {
    const current = byLevel[i];
    const next = byLevel[i + 1];
    if (current.outlineLevel === next.outlineLevel) continue;
    pairs += 1;
    const currentIndent =
      current.indent.marginLeft + current.indent.marginIntent + current.leadingWhitespace.length;
    const nextIndent =
      next.indent.marginLeft + next.indent.marginIntent + next.leadingWhitespace.length;
    if (nextIndent >= currentIndent) monotonic += 1;
  }
  const indentHierarchy = pairs === 0 ? 0 : clamp01(monotonic / pairs);

  // repetitionEvidence — 2회 이상 반복되는 Signature 군집에 속한 문단 비율.
  const repeated = input.clusters
    .filter((cluster) => cluster.count >= 2)
    .reduce((sum, cluster) => sum + cluster.count, 0);
  const repetitionEvidence = paragraphCount === 0 ? 0 : clamp01(repeated / paragraphCount);

  // positionEvidence — 개요 문단의 연속 전이가 "같거나 한 단계 깊어지는" 비율.
  // 자리(순서)가 계층과 모순되지 않는다는 근거다.
  const assignments = input.outline.assignments;
  const levelByPatternId = new Map(
    input.outline.patterns.map((pattern) => [pattern.patternId, pattern.outlineLevel] as const),
  );
  let transitions = 0;
  let wellFormed = 0;
  for (let i = 0; i + 1 < assignments.length; i += 1) {
    const from = levelByPatternId.get(assignments[i].patternId) ?? 1;
    const to = levelByPatternId.get(assignments[i + 1].patternId) ?? 1;
    transitions += 1;
    if (to <= from + 1) wellFormed += 1;
  }
  const positionEvidence = transitions === 0 ? 0 : clamp01(wellFormed / transitions);

  // semanticHint — 절 제목 어휘가 몇 종류 나타나는가(최대 SEMANTIC_TARGET).
  const seen = new Set<string>();
  for (const source of input.paragraphs) {
    const text = paragraphText(source);
    for (const keyword of SEMANTIC_KEYWORDS) {
      if (text.includes(keyword)) seen.add(keyword);
    }
  }
  const semanticHint = clamp01(seen.size / SEMANTIC_TARGET);

  const components: ConfidenceComponents = {
    styleConsistency: round4(styleConsistency),
    prefixConsistency: round4(prefixConsistency),
    indentHierarchy: round4(indentHierarchy),
    repetitionEvidence: round4(repetitionEvidence),
    positionEvidence: round4(positionEvidence),
    semanticHint: round4(semanticHint),
  };

  return {
    components,
    value: computeConfidence(components),
    basis: {
      styleConsistency: `distinctSignatures=${distinct} paragraphs=${paragraphCount} (weight ${CONFIDENCE_WEIGHTS.styleConsistency})`,
      prefixConsistency: `repeatedPrefixedParagraphs=${repeatedPrefixed} prefixedParagraphs=${prefixed} (weight ${CONFIDENCE_WEIGHTS.prefixConsistency})`,
      indentHierarchy: `monotonicLevelPairs=${monotonic} levelPairs=${pairs} (weight ${CONFIDENCE_WEIGHTS.indentHierarchy})`,
      repetitionEvidence: `paragraphsInRepeatedClusters=${repeated} paragraphs=${paragraphCount} (weight ${CONFIDENCE_WEIGHTS.repetitionEvidence})`,
      positionEvidence: `wellFormedTransitions=${wellFormed} transitions=${transitions} (weight ${CONFIDENCE_WEIGHTS.positionEvidence})`,
      semanticHint: `semanticKeywordKinds=${seen.size} target=${SEMANTIC_TARGET} staticRegions=${input.staticRegions.length} (weight ${CONFIDENCE_WEIGHTS.semanticHint})`,
    },
  };
}
