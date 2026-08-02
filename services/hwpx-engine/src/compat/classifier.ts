import {
  rollUpVerdict,
  type DocumentCompatibilityVerdict,
  type HwpxFinding,
  type HwpxObjectClass,
  type ObjectClassification,
  type UnclassifiedElement,
} from '@une/domain';
import { anchorOf } from '../ir/anchors';
import type { PackageAnalysisResult } from '../package/package-analysis';
import { KNOWN_NAMESPACE_URIS, isElement, walk, type XmlElement } from '../package/xml';
import {
  CLASSIFICATION_TRANSPARENT_ELEMENTS,
  REJECT_RULES,
  capsVerdictOf,
  matchElementRule,
  matchPartRule,
  type ObjectRule,
} from './object-rules';

/**
 * 객체 단위 분류 (AC4). 각 판정은 `{objectClass, reasonCode, locator, evidence}`
 * — evidence는 G15-1의 "판정과 근거 재현" 요구사항이라 비워 둘 수 없다.
 *
 * 문서 판정은 도메인 `rollUpVerdict`를 **호출**한다. 롤업 규칙(ADR-29 D2 1~4)을
 * 엔진에서 다시 구현하면 두 벌이 되고, 둘이 어긋나는 순간 어느 쪽이 정본인지
 * 알 수 없게 된다.
 *
 * 보안(security.md): evidence에 본문 텍스트·PrvText·BinData를 넣지 않는다.
 * 요소 이름, 속성 키, 카운트, 규칙 근거만 쓴다.
 */

/** 도메인 `ObjectClassification`에 층(Part/요소)을 덧붙인 엔진 소유 래퍼. */
export interface ClassifiedObject {
  readonly scope: 'PART' | 'ELEMENT';
  readonly classification: ObjectClassification;
}

export interface ClassificationResult {
  readonly objects: readonly ClassifiedObject[];
  readonly counts: Readonly<Record<HwpxObjectClass, number>>;
  readonly verdict: DocumentCompatibilityVerdict;
  readonly confidence: number;
  readonly findings: readonly HwpxFinding[];
  /**
   * 규칙표가 잡지 않은 요소 전량 (리뷰 M-2).
   *
   * 이전 구현은 `continue`로 버렸다. 그러면 "catch-all 적중 0건" 가드가
   * 구멍의 증상(=아무것도 안 잡힘)과 정상(=전부 명시 규칙이 잡음)을 구별하지
   * 못한다. 버리지 않고 실어 보내면 회귀 테스트가 두 상태를 값으로 가른다.
   */
  readonly unclassifiedElements: readonly UnclassifiedElement[];
}

function classificationOf(
  rule: ObjectRule,
  locator: string,
  evidence: string,
): ObjectClassification {
  return {
    objectClass: rule.objectClass,
    scope: rule.scope,
    reasonCode: rule.reasonCode,
    locator,
    evidence,
    capsVerdict: capsVerdictOf(rule),
  };
}

/** 속성 **키만** 나열한다. 값은 개인정보/본문일 수 있다. */
function attributeKeys(element: XmlElement): string {
  const keys = Object.keys(element.attributes).sort();
  return keys.length === 0 ? '(no attributes)' : keys.join(',');
}

export function classifyParts(analysis: PackageAnalysisResult): ClassifiedObject[] {
  const objects: ClassifiedObject[] = [];
  for (const entry of analysis.entries) {
    const rule = matchPartRule(entry.partPath);
    const manifested = analysis.hpfManifest.some((item) => item.href === entry.partPath);
    objects.push({
      scope: 'PART',
      classification: classificationOf(
        rule,
        entry.partPath,
        `zip order=${entry.order} method=${entry.method} bytes=${entry.uncompressedSize} ` +
          `hpfManifest=${manifested ? 'yes' : 'no'} sha256=${entry.sha256.slice(0, 16)} :: ${rule.rationale}`,
      ),
    });
  }
  return objects;
}

export interface ElementClassificationResult {
  readonly objects: readonly ClassifiedObject[];
  readonly unclassified: readonly UnclassifiedElement[];
}

export function classifyElements(
  parsedParts: ReadonlyMap<string, XmlElement>,
): ElementClassificationResult {
  const objects: ClassifiedObject[] = [];
  const unclassified: UnclassifiedElement[] = [];
  for (const [, root] of [...parsedParts].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (root.localName !== 'sec') continue;
    for (const element of walk(root)) {
      if (CLASSIFICATION_TRANSPARENT_ELEMENTS.has(element.localName)) continue;
      const parentLocal = element.parent ? element.parent.localName : null;
      // hp:ctrl은 투명하므로 그 자식의 "실질 부모"는 ctrl 그대로 본다.
      const rule = matchElementRule(
        element.localName,
        parentLocal,
        element.namespaceUri,
        KNOWN_NAMESPACE_URIS,
      );
      if (!rule) {
        // 버리지 않는다(리뷰 M-2). 여기 쌓이는 것은 대부분 검토 완료된 속성
        // 노드(`CLASSIFICATION_PROPERTY_PARENTS`)지만, 판정은 테스트가 한다.
        unclassified.push({
          localName: element.localName,
          parentLocalName: parentLocal,
          anchor: anchorOf(element),
        });
        continue;
      }
      const childElements = element.children.filter(isElement).length;
      objects.push({
        scope: 'ELEMENT',
        classification: classificationOf(
          rule,
          anchorOf(element),
          `element=${element.qName} ns=${element.namespaceUri ?? '(none)'} ` +
            `attrs=[${attributeKeys(element)}] childElements=${childElements} :: ${rule.rationale}`,
        ),
      });
    }
  }
  return { objects, unclassified };
}

/** 필수 Part 누락·mimetype 불일치·치명 dangling 참조 → REJECT 객체. */
export function classifyRejects(analysis: PackageAnalysisResult): ClassifiedObject[] {
  const objects: ClassifiedObject[] = [];
  for (const missing of analysis.requiredParts.missing) {
    objects.push({
      scope: 'PART',
      classification: classificationOf(
        REJECT_RULES.requiredPartMissing,
        missing,
        `required part missing :: ${REJECT_RULES.requiredPartMissing.rationale}`,
      ),
    });
  }
  for (const item of analysis.findings) {
    if (item.code === 'HWPX-1005' && item.severity === 'FATAL') {
      objects.push({
        scope: 'ELEMENT',
        classification: classificationOf(
          REJECT_RULES.danglingReference,
          item.locator,
          `${item.code} ${item.detail} :: ${REJECT_RULES.danglingReference.rationale}`,
        ),
      });
    }
  }
  return objects;
}

export function countByClass(
  objects: readonly ClassifiedObject[],
): Record<HwpxObjectClass, number> {
  const counts: Record<HwpxObjectClass, number> = {
    NATIVE_EDIT: 0,
    PRESERVE_ONLY: 0,
    FLATTEN_EXPORT_ONLY: 0,
    REJECT: 0,
  };
  for (const object of objects) counts[object.classification.objectClass] += 1;
  return counts;
}

export interface ClassifyInput {
  readonly analysis: PackageAnalysisResult;
  /** TemplateAnalyzer가 산출한 confidence. 롤업 규칙 4의 입력. */
  readonly confidence: number;
  /** IR 빌드 단계에서 추가로 수집된 finding(HWPX-1005 등). */
  readonly extraFindings?: readonly HwpxFinding[];
}

export function classify(input: ClassifyInput): ClassificationResult {
  const findings: HwpxFinding[] = [...input.analysis.findings, ...(input.extraFindings ?? [])];
  const elements = classifyElements(input.analysis.parsedParts);
  const objects = [
    ...classifyRejects({ ...input.analysis, findings }),
    ...classifyParts(input.analysis),
    ...elements.objects,
  ];
  const classifications = objects.map((object) => object.classification);
  // §1.4 HWPX-1004("미지원 객체 존재 → LIMITED + 원문 보존")는 판정 상한과
  // **같은 조건**이어야 한다. 상한을 유발하지 않는 객체(PART 층 보존 Part,
  // 레이아웃 속성·공백)에까지 이 finding을 붙이면 "원문 보존 모드로 엽니다"가
  // 모든 문서에 뜨면서 정작 판정은 AUTO인, 서로 어긋나는 화면이 된다.
  const hasUnsupported = classifications.some(
    (item) =>
      item.scope === 'ELEMENT' &&
      item.capsVerdict &&
      (item.objectClass === 'PRESERVE_ONLY' || item.objectClass === 'FLATTEN_EXPORT_ONLY'),
  );
  // 중복 판정은 **코드+심각도**로 한다. 코드만 보면 package-analysis가 항상
  // 붙이는 INFO HWPX-1004(비매니페스트 Part 보존 안내)에 가려 상한 사유
  // finding이 영영 추가되지 않는다 — 실제로 실 코퍼스 6종 전부에서 그랬다.
  if (
    hasUnsupported &&
    !findings.some((item) => item.code === 'HWPX-1004' && item.severity === 'DEGRADING')
  ) {
    findings.push({
      code: 'HWPX-1004',
      severity: 'DEGRADING',
      locator: '(document)',
      detail: '미지원 객체가 있어 원문 보존 모드로 엽니다',
    });
  }
  return {
    objects,
    counts: countByClass(objects),
    verdict: rollUpVerdict({ objects: classifications, findings, confidence: input.confidence }),
    confidence: input.confidence,
    findings,
    unclassifiedElements: elements.unclassified,
  };
}
