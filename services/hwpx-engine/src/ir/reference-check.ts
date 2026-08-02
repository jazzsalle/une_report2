import type { RawXmlAnchor } from '@une/domain';
import { walk, type XmlElement } from '../package/xml';
import { anchorOf } from './anchors';
import type { HeaderIndex } from './header-index';

/**
 * 참조 무결성 검사 — §1.4-4 색인 대상 전체 (CC-140 리뷰 m-5).
 *
 * §1.4-4는 "paraPr/charPr/style/numbering/**bullet/binData**를 먼저 색인한다"고
 * 못박는다. 그런데 최초 구현의 I3와 HWPX-1005 신고는 앞의 넷만 봤다. 그러면
 * `hp:pic`이 없는 `binaryItemIDRef`를 가리켜도 조용히 통과하고, Export 단계에서
 * 그림이 빈 상자로 나온 뒤에야 발견된다.
 *
 * 검사 정의를 여기 한 곳에 두고 `ir-builder`(finding)와 `invariants`(I3 위반)가
 * **같은 함수**를 부른다. 두 벌로 두면 어느 쪽이 정본인지 알 수 없게 된다.
 */

export interface DanglingReference {
  readonly locator: RawXmlAnchor;
  readonly detail: string;
}

/** 이진 데이터 참조를 나르는 속성 이름. `hc:img@binaryItemIDRef`가 대표. */
const BINARY_REF_ATTRIBUTES = ['binaryItemIDRef', 'binDataIDRef'] as const;

/**
 * 섹션 트리의 이진 데이터 참조 중 header.xml/content.hpf 색인에 없는 것.
 * 실 코퍼스 `situation-report-template`는 `hc:img@binaryItemIDRef=image1..3`을
 * 쓰고 content.hpf 매니페스트의 `opf:item@id`와 일치한다(실측).
 */
export function findDanglingBinaryReferences(
  root: XmlElement,
  headerIndex: HeaderIndex,
): DanglingReference[] {
  const dangling: DanglingReference[] = [];
  for (const element of walk(root)) {
    for (const attribute of BINARY_REF_ATTRIBUTES) {
      const value = element.attributes[attribute];
      if (value === undefined || value === '') continue;
      if (headerIndex.binDataIds.has(value)) continue;
      dangling.push({
        locator: anchorOf(element),
        detail: `${attribute}=${value}가 header.xml binData/content.hpf 매니페스트에 없습니다`,
      });
    }
  }
  return dangling;
}

/**
 * 문단이 참조하는 글머리표(bullet) 참조 검사.
 *
 * `hh:paraPr > hh:heading[type=BULLET]@idRef`가 `hh:bullets`를 가리킨다.
 * type이 NUMBER/OUTLINE일 때 numbering을 보는 것과 같은 층의 검사다.
 * 반환값이 null이면 참조가 성립하거나 검사 대상이 아니다.
 */
export function checkBulletReference(
  headerIndex: HeaderIndex,
  paraPrId: number | null,
): string | null {
  if (paraPrId === null) return null;
  const detail = headerIndex.paraPr.get(paraPrId);
  if (!detail || detail.headingType !== 'BULLET' || detail.headingIdRef === null) return null;
  if (headerIndex.bulletIds.has(detail.headingIdRef)) return null;
  return `bullet idRef=${detail.headingIdRef}가 header.xml bullets에 없습니다`;
}
