import type { RawXmlAnchor } from '@une/domain';
import { elementsOf, type XmlElement } from '../package/xml';

/**
 * rawXmlAnchor 발급·역참조 (ADR-29 D6).
 *
 * 형식: `partPath#step/step/...`, step은 `localName[1-base 서수]`.
 * 예: `Contents/section0.xml#p[17]`, `Contents/section0.xml#p[3]/run[1]/tbl[1]`.
 *
 * 바이트 오프셋을 쓰지 않는 이유는 D6에 있다 — UTF-8 바이트/UTF-16 코드유닛
 * 이중 인덱싱이 생기고, CC-150 SelectionResolver의 문자 offset과 층이 섞인다.
 * 앵커는 **구조 위치만** 가리킨다.
 *
 * 루트 요소는 경로에서 생략한다(Part 하나에 루트는 하나뿐이라 정보가 없다).
 * 그래서 section0.xml의 17번째 `hp:p`가 곧 `#p[17]`이 된다 — 설계 예시와 같다.
 */

export const ANCHOR_SEPARATOR = '#';

export function anchorOf(element: XmlElement): RawXmlAnchor {
  const steps: string[] = [];
  let node: XmlElement | null = element;
  while (node && node.parent) {
    steps.push(`${node.localName}[${node.ordinal}]`);
    node = node.parent;
  }
  steps.reverse();
  // 루트 요소 자신을 앵커링하면 경로가 빈다. 그 경우에만 루트를 한 단계로
  // 적어 `partAnchor`와 같은 형태를 낸다(빈 경로는 역참조도 스키마도 깬다).
  if (steps.length === 0) return partAnchor(element.partPath, element.localName);
  return `${element.partPath}${ANCHOR_SEPARATOR}${steps.join('/')}`;
}

/**
 * 루트 요소 자체를 가리키는 앵커. secPr가 없는 section의 pageSettings처럼
 * "Part는 있는데 지목할 하위 요소가 없는" 자리에 쓴다.
 *
 * 경로를 비워 `partPath#`로 두지 않는 이유는 두 가지다. (1) `rawXmlAnchor`는
 * 언제나 무언가를 지목해야 역참조(I2)가 의미를 갖는다. (2) 계약 스키마
 * (`contracts/schemas/document-ir.schema.json`)의 `rawXmlAnchor` 패턴이
 * `^[^#]+#.+$`라 `#` 뒤가 비면 IR 전체가 스키마 위반이 된다.
 *
 * 루트는 `anchorOf`가 경로에서 생략하는 대상이므로(설계 예시 `#p[17]` 유지),
 * 여기서만 예외적으로 `sec[1]`처럼 명시하고 `resolveAnchor`가 이를 인식한다.
 */
export function partAnchor(partPath: string, rootLocalName = 'sec'): RawXmlAnchor {
  return `${partPath}${ANCHOR_SEPARATOR}${rootLocalName}[1]`;
}

export interface ParsedAnchor {
  readonly partPath: string;
  readonly steps: readonly { readonly localName: string; readonly ordinal: number }[];
}

export function parseAnchor(anchor: RawXmlAnchor): ParsedAnchor | null {
  const separator = anchor.indexOf(ANCHOR_SEPARATOR);
  if (separator < 0) return null;
  const partPath = anchor.slice(0, separator);
  const path = anchor.slice(separator + 1);
  if (path === '') return { partPath, steps: [] };
  const steps: { localName: string; ordinal: number }[] = [];
  for (const raw of path.split('/')) {
    const match = /^([-A-Za-z0-9_.]+)\[(\d+)\]$/.exec(raw);
    if (!match) return null;
    steps.push({ localName: match[1], ordinal: Number(match[2]) });
  }
  return { partPath, steps };
}

/**
 * 앵커 역참조. I2(모든 앵커가 실재 Part+요소를 지목)를 기계로 확인하는 함수다.
 * 못 찾으면 null — 호출자가 finding으로 올린다.
 */
export function resolveAnchor(
  anchor: RawXmlAnchor,
  parts: ReadonlyMap<string, XmlElement>,
): XmlElement | null {
  const parsed = parseAnchor(anchor);
  if (!parsed) return null;
  let node = parts.get(parsed.partPath) ?? null;
  if (!node) return null;
  let steps = parsed.steps;
  // `partAnchor`가 낸 루트 지목 앵커(`#sec[1]`)를 인식한다. HWPX는 hs:sec를
  // 중첩하지 않으므로 루트와 같은 이름의 직계 자식이 없을 때만 소비한다.
  if (
    steps.length > 0 &&
    steps[0].localName === node.localName &&
    steps[0].ordinal === 1 &&
    !elementsOf(node).some((child) => child.localName === node!.localName)
  ) {
    steps = steps.slice(1);
  }
  for (const step of steps) {
    const candidates: XmlElement[] = elementsOf(node).filter(
      (child) => child.localName === step.localName,
    );
    const next = candidates[step.ordinal - 1];
    if (!next) return null;
    node = next;
  }
  return node;
}
