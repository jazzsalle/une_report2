import type { HwpxObjectClass } from '@une/domain';

/**
 * 객체 호환성 규칙표 (ADR v1.1 §8.4 등급표, ADR-29 D2 객체층).
 *
 * **코드 분기가 아니라 데이터**다. 등급이 if 문 안에 흩어지면 G15-1이 요구하는
 * "판정과 근거 재현"이 불가능해진다(무엇이 왜 그 등급인지 표로 보여줄 수
 * 없다). 여기 배열이 정본이고 `classifier.ts`는 첫 일치 규칙을 적용할 뿐이다.
 *
 * 규칙 순서 = 우선순위. 위에서부터 처음 일치하는 규칙이 이긴다.
 */

export type RuleScope = 'PART' | 'ELEMENT';

export interface ObjectRule {
  /** 안정 규칙 ID. evidence·회귀 스냅샷의 키. */
  readonly reasonCode: string;
  readonly scope: RuleScope;
  readonly objectClass: HwpxObjectClass;
  /** PART 규칙: 경로 패턴. */
  readonly partPattern?: RegExp;
  /** ELEMENT 규칙: localName 집합. */
  readonly localNames?: readonly string[];
  /** ELEMENT 규칙: 부모 localName 제한(예: hp:ctrl 하위만). */
  readonly parentLocalNames?: readonly string[];
  /**
   * 이 등급이 **문서 판정 상한(LIMITED)을 유발하는가**. 기본 true.
   *
   * 등급 축과 상한 축은 다르다(CC-140 리뷰 M-3). §8.4의 `NATIVE_EDIT`는
   * "파싱·렌더·편집·재저장 검증 완료 / 편집 전체 허용 / 변경 Part 최소저장"을
   * 뜻하고 CC-160 Serializer가 등급으로 저장 정책을 분기한다(ADR-29 D11).
   * IR이 파싱한 적 없는 XML에 그 등급을 붙이면 "최소저장"이 파싱되지 않은
   * 바이트에 적용된다. 그래서 등급은 사실대로 두고, 상한만 이 플래그로
   * 뗀다 — §8.4 "사용자 표시" 컬럼이 "정상"인 대상이 그것이다.
   */
  readonly capsVerdict?: boolean;
  /** 설계 근거 인용. 규칙마다 출처가 없으면 규칙이 아니라 취향이다. */
  readonly rationale: string;
}

/** 규칙의 상한 유발 여부. 미지정은 true(= 상한 유발)가 안전한 기본값이다. */
export function capsVerdictOf(rule: ObjectRule): boolean {
  return rule.capsVerdict !== false;
}

/**
 * 분류에서 **투명한** 요소 — 그 자체는 객체가 아니고, 자식이 분류된다.
 * 분류 대상에서 빼는 것이지 "무시"가 아니다: 전부 IR에 실리고 바이트로 보존된다.
 *
 * - `hp:ctrl`은 컨트롤을 감싸는 껍데기다. 껍데기와 알맹이를 둘 다 세면 같은
 *   객체가 두 번 잡힌다.
 * - `hp:secPr`와 그 하위는 SectionIR.pageSettings로 모델링되고 앵커+바이트로
 *   보존되므로 "미지원 객체"가 아니다. LIMITED 상한을 유발하지 않게 한다.
 * - `hp:subList`는 셀/머리말 본문의 컨테이너, `hp:linesegarray`는 배치 캐시다.
 */
export const CLASSIFICATION_TRANSPARENT_ELEMENTS: ReadonlySet<string> = new Set([
  'sec',
  'secPr',
  'ctrl',
  'linesegarray',
  'cellAddr',
  'cellSz',
  'cellMargin',
  'sz',
  'pos',
  'outMargin',
  'inMargin',
  'subList',
]);

export const OBJECT_RULES: readonly ObjectRule[] = Object.freeze([
  // ── PART 층 ──────────────────────────────────────────────────────────────
  {
    reasonCode: 'PART-CONTENT-SECTION',
    scope: 'PART',
    objectClass: 'NATIVE_EDIT',
    partPattern: /^Contents\/section\d+\.xml$/,
    rationale: '§1.3 SectionIR이 직접 모델링하는 본문 Part',
  },
  {
    reasonCode: 'PART-CONTENT-HEADER',
    scope: 'PART',
    objectClass: 'NATIVE_EDIT',
    partPattern: /^Contents\/header\.xml$/,
    rationale: '§1.4-4 참조표 색인 대상. StyleIndex로 모델링',
  },
  {
    reasonCode: 'PART-OPC-DESCRIPTOR',
    scope: 'PART',
    objectClass: 'NATIVE_EDIT',
    partPattern: /^(mimetype|version\.xml|META-INF\/container\.xml|Contents\/content\.hpf)$/,
    rationale: '§1.4-1 교차검증 대상 컨테이너 기술자. 값이 IR로 해석된다',
  },
  {
    reasonCode: 'PART-SCRIPT',
    scope: 'PART',
    objectClass: 'PRESERVE_ONLY',
    partPattern: /^Scripts\/.+$/,
    rationale: '§8.4 PRESERVE_ONLY: 편집하지 않고 raw 보존. 실행하지 않는다',
  },
  {
    reasonCode: 'PART-RDF',
    scope: 'PART',
    objectClass: 'PRESERVE_ONLY',
    partPattern: /^META-INF\/container\.rdf$/,
    rationale: '§8.4 PRESERVE_ONLY: 해석하지 않는 메타데이터 그래프',
  },
  {
    reasonCode: 'PART-PREVIEW',
    scope: 'PART',
    objectClass: 'PRESERVE_ONLY',
    partPattern: /^Preview\/.+$/,
    rationale: '§8.4 PRESERVE_ONLY: 미리보기 산출물. 편집 대상이 아니며 원문 유지',
  },
  {
    reasonCode: 'PART-BINDATA',
    scope: 'PART',
    objectClass: 'PRESERVE_ONLY',
    partPattern: /^BinData\/.+$/,
    rationale: '§8.4 PRESERVE_ONLY: 삽입 이진 데이터. 바이트 단위 보존',
  },
  {
    reasonCode: 'PART-UNMODELED',
    scope: 'PART',
    objectClass: 'PRESERVE_ONLY',
    partPattern: /^.+$/,
    rationale: '§1.3 UnknownPart: IR이 모델링하지 않는 Part 전량 원문 보존',
  },

  // ── ELEMENT 층: NATIVE_EDIT ─────────────────────────────────────────────
  {
    reasonCode: 'OBJ-PARAGRAPH',
    scope: 'ELEMENT',
    objectClass: 'NATIVE_EDIT',
    localNames: ['p'],
    rationale: '§8.4 NATIVE_EDIT: ParagraphIR로 파싱·편집·재저장',
  },
  {
    reasonCode: 'OBJ-RUN-TEXT',
    scope: 'ELEMENT',
    objectClass: 'NATIVE_EDIT',
    localNames: ['run', 't', 'tab', 'lineseg'],
    rationale: '§8.4 NATIVE_EDIT: RunIR 텍스트·탭·라인세그',
  },
  {
    reasonCode: 'OBJ-TABLE',
    scope: 'ELEMENT',
    objectClass: 'NATIVE_EDIT',
    localNames: ['tbl', 'tr', 'tc', 'cellSpan'],
    rationale: '§8.4 NATIVE_EDIT: TableIR 행/열/span',
  },

  // ── ELEMENT 층: FLATTEN_EXPORT_ONLY ─────────────────────────────────────
  {
    reasonCode: 'OBJ-EQUATION',
    scope: 'ELEMENT',
    objectClass: 'FLATTEN_EXPORT_ONLY',
    localNames: ['equation'],
    rationale: '§8.4 FLATTEN_EXPORT_ONLY: 수식은 원본 편집 불가, 사본 Export만',
  },
  {
    reasonCode: 'OBJ-OLE',
    scope: 'ELEMENT',
    objectClass: 'FLATTEN_EXPORT_ONLY',
    localNames: ['ole'],
    rationale: '§8.4 FLATTEN_EXPORT_ONLY: OLE 개체는 원본 HWPX 저장 금지 대상',
  },
  {
    reasonCode: 'OBJ-CHART',
    scope: 'ELEMENT',
    objectClass: 'FLATTEN_EXPORT_ONLY',
    localNames: ['chart', 'chartIDRef', 'chartSpace'],
    rationale: '§8.4 FLATTEN_EXPORT_ONLY: ooxmlchart 계열 차트',
  },
  {
    reasonCode: 'OBJ-VIDEO',
    scope: 'ELEMENT',
    objectClass: 'FLATTEN_EXPORT_ONLY',
    localNames: ['video'],
    rationale: '§8.4 FLATTEN_EXPORT_ONLY: 동영상 개체',
  },
  {
    reasonCode: 'OBJ-FORM-CONTROL',
    scope: 'ELEMENT',
    objectClass: 'FLATTEN_EXPORT_ONLY',
    localNames: [
      'formCtrl',
      'btn',
      'radioBtn',
      'checkBtn',
      'comboBox',
      'listBox',
      'edit',
      'scrollBar',
    ],
    rationale: '§8.4 FLATTEN_EXPORT_ONLY: 폼 컨트롤은 상태를 가진 개체',
  },

  // ── ELEMENT 층: PRESERVE_ONLY이되 상한을 유발하지 않는 것 ───────────────
  //
  // 아래 두 규칙은 CC-140 실측 시정이고, 리뷰 M-3으로 한 번 더 고쳐졌다.
  //
  // 1차 구현에서는 catch-all(OBJ-CTRL-UNMODELED / OBJ-INLINE-UNMODELED)이
  // 이들을 삼켜 **모든 실문서가 LIMITED**가 되었고 AUTO/CONFIRM 밴드가
  // 구조적으로 도달 불가능했다. 2차 시정에서 NATIVE_EDIT로 올려 상한을
  // 피했는데, 그것은 **거짓 등급**이었다: IR은 이 8종을 전혀 모델링하지 않고
  // 앵커로만 보존하므로 §8.4가 NATIVE_EDIT에 부여한 "파싱·렌더·편집·재저장
  // 검증 완료 / 변경 Part 최소저장"이 성립하지 않는다. CC-160이 등급으로
  // 저장 정책을 분기하면(ADR-29 D11) 파싱한 적 없는 XML에 최소저장이 걸린다.
  //
  // 그래서 등급은 사실대로 PRESERVE_ONLY로 두고, 상한만 `capsVerdict: false`로
  // 뗀다. 판별 기준은 §8.4 등급표의 "사용자 표시" 컬럼이다 — 사용자에게
  // "제한 아이콘·설명"을 띄울 대상인가? 단 속성과 빈칸은 아니다.
  // 원문 보존은 그대로다(바이트는 I5, 앵커는 I2가 덮는다).
  {
    reasonCode: 'OBJ-SECTION-LAYOUT-PROPERTY',
    scope: 'ELEMENT',
    objectClass: 'PRESERVE_ONLY',
    capsVerdict: false,
    localNames: ['colPr', 'pageHiding', 'pageBorderFill', 'masterPage', 'pagePr'],
    parentLocalNames: ['ctrl'],
    rationale:
      '§8.4 사용자 표시 "정상": 단·페이지 표시 설정은 섹션 레이아웃 속성이며 ' +
      'hp:secPr와 같은 층이다. IR이 파싱하지 않으므로 등급은 PRESERVE_ONLY지만 ' +
      '제한 아이콘 대상이 아니라 문서 판정을 낮추지 않는다',
  },
  {
    reasonCode: 'OBJ-WHITESPACE-STRUCTURE',
    scope: 'ELEMENT',
    objectClass: 'PRESERVE_ONLY',
    capsVerdict: false,
    localNames: ['fwSpace', 'nbSpace', 'lineBreak', 'hypen'],
    parentLocalNames: ['run', 't'],
    rationale:
      '§1.6-3 공백(space/tab/비분리 공백)은 계층 신호로 따로 저장하는 대상이지 ' +
      '미지원 객체가 아니다. 고정폭 빈칸·묶음 빈칸은 텍스트 스트림에 문자로 ' +
      '정규화되고 원문은 앵커로 보존되므로 문서 판정을 낮추지 않는다',
  },

  // ── ELEMENT 층: PRESERVE_ONLY ───────────────────────────────────────────
  {
    reasonCode: 'OBJ-PIC-BINDATA',
    scope: 'ELEMENT',
    objectClass: 'PRESERVE_ONLY',
    localNames: ['pic'],
    rationale: '§8.4 PRESERVE_ONLY: 그림은 BinData 참조와 함께 원문 복사',
  },
  {
    reasonCode: 'OBJ-CTRL-HEADER-FOOTER',
    scope: 'ELEMENT',
    objectClass: 'PRESERVE_ONLY',
    localNames: ['header', 'footer'],
    parentLocalNames: ['ctrl'],
    rationale: '§8.4 PRESERVE_ONLY: 머리말/꼬리말 컨트롤',
  },
  {
    reasonCode: 'OBJ-CTRL-NOTE',
    scope: 'ELEMENT',
    objectClass: 'PRESERVE_ONLY',
    localNames: ['footNote', 'endNote'],
    parentLocalNames: ['ctrl'],
    rationale: '§8.4 PRESERVE_ONLY: 각주/미주 컨트롤',
  },
  {
    reasonCode: 'OBJ-CTRL-PAGE-NUMBER',
    scope: 'ELEMENT',
    objectClass: 'PRESERVE_ONLY',
    localNames: ['pageNum', 'newNum', 'autoNum', 'pageNumCtrl'],
    parentLocalNames: ['ctrl'],
    rationale:
      '§8.4 PRESERVE_ONLY: 쪽번호/새번호/자동번호는 v1이 편집하지 못하는 ' +
      '자동 생성 콘텐츠다(hp:pageHiding은 표시 설정이라 여기 속하지 않는다)',
  },
  {
    reasonCode: 'OBJ-FIELD',
    scope: 'ELEMENT',
    objectClass: 'PRESERVE_ONLY',
    localNames: ['fieldBegin', 'fieldEnd'],
    rationale: '§8.4 PRESERVE_ONLY: 누름틀/필드 경계. 내용 편집은 상위 층 책임',
  },
  // ── catch-all: 여기까지 내려온 것은 **진짜 미지의 것**이어야 한다 ────────
  //
  // catch-all이 알려진 양성(레이아웃 속성·공백)을 조용히 삼키면 문서 판정을
  // 지배하면서도 아무도 눈치채지 못한다. 실제로 CC-140 최초 구현에서 그 일이
  // 벌어졌다. 그래서 (1) 알려진 것은 위쪽 명시 규칙으로 올렸고, (2) 실 코퍼스
  // 6종에서 catch-all이 잡는 요소가 0건임을 테스트로 고정했다
  // (`corpus-regression.test.ts` "catch-all 회귀 가드").
  {
    reasonCode: 'OBJ-CTRL-UNMODELED',
    scope: 'ELEMENT',
    objectClass: 'PRESERVE_ONLY',
    parentLocalNames: ['ctrl'],
    rationale: '§1.3 "알려지지 않은 컨트롤은 raw fragment로 보존" (catch-all)',
  },
  {
    reasonCode: 'OBJ-INLINE-UNMODELED',
    scope: 'ELEMENT',
    objectClass: 'PRESERVE_ONLY',
    parentLocalNames: ['run', 't'],
    rationale: '§1.3 run/t 하위 미모델링 인라인 개체는 원문 보존 (catch-all)',
  },
]);

/**
 * catch-all 규칙 ID. 이들이 무언가를 잡았다는 것은 "우리가 모르는 구조를
 * 만났다"는 뜻이고, 등급을 자동으로 매기는 대신 **명시적 판단이 필요하다**는
 * 신호다. 회귀 테스트가 이 목록을 기준으로 실 코퍼스 적중 0건을 지킨다.
 */
export const CATCH_ALL_REASON_CODES: readonly string[] = Object.freeze([
  'OBJ-CTRL-UNMODELED',
  'OBJ-INLINE-UNMODELED',
  'OBJ-UNKNOWN-NAMESPACE',
]);

/** 미지 네임스페이스 요소 규칙(패턴이 아니라 조건이라 별도 상수). */
export const UNKNOWN_NAMESPACE_RULE: ObjectRule = Object.freeze({
  reasonCode: 'OBJ-UNKNOWN-NAMESPACE',
  scope: 'ELEMENT',
  objectClass: 'PRESERVE_ONLY',
  rationale: '§1.3 "알려지지 않은 ... 네임스페이스는 raw fragment로 보존"',
});

/** 패키지 수준 거부 규칙 — 문서 판정 REJECT의 근거(§8.4 마지막 행). */
export const REJECT_RULES = Object.freeze({
  mimetypeMismatch: {
    reasonCode: 'OBJ-REJECT-MIMETYPE',
    scope: 'PART',
    objectClass: 'REJECT',
    rationale: '§8.4 REJECT: mimetype 불일치는 업로드 거부',
  } satisfies ObjectRule,
  requiredPartMissing: {
    reasonCode: 'OBJ-REJECT-REQUIRED-PART',
    scope: 'PART',
    objectClass: 'REJECT',
    rationale: '§1.4 HWPX-1003 필수 Part 누락 → REJECT',
  } satisfies ObjectRule,
  danglingReference: {
    reasonCode: 'OBJ-REJECT-DANGLING-REF',
    scope: 'ELEMENT',
    objectClass: 'REJECT',
    rationale: '§1.4 HWPX-1005 치명 참조 깨짐 → REJECT',
  } satisfies ObjectRule,
});

export function matchPartRule(partPath: string): ObjectRule {
  for (const rule of OBJECT_RULES) {
    if (rule.scope !== 'PART' || !rule.partPattern) continue;
    if (rule.partPattern.test(partPath)) return rule;
  }
  // PART-UNMODELED가 /^.+$/ 이므로 도달 불가. 방어적으로 남긴다.
  throw new Error(`분류 규칙에 걸리지 않은 Part 경로: ${partPath}`);
}

/**
 * **검토 완료된 속성 노드 컨테이너** (CC-140 리뷰 M-2).
 *
 * 이 요소들의 자식은 "객체"가 아니라 그 객체의 **속성**이다 — 예를 들어
 * `hp:pic`의 `hc:imgRect/hc:pt0`은 그림과 별개의 객체가 아니라 그림의 자리다.
 * 규칙표가 이들을 잡지 않는 것은 구멍이 아니라 설계이며, 그 사실을 데이터로
 * 남겨 회귀 테스트가 "미분류 = 검토된 속성 노드뿐"임을 매번 확인하게 한다.
 *
 * 실 코퍼스 6종 실측으로 도출했고, 여기 없는 부모 밑에서 미분류가 나오면
 * **그것은 진짜 미지의 구조**이므로 테스트가 실패해야 한다.
 */
export const CLASSIFICATION_PROPERTY_PARENTS: ReadonlySet<string> = new Set([
  // 섹션 속성 트리 — SectionIR.pageSettings 앵커 + I5 바이트가 덮는다.
  'secPr',
  'pagePr',
  'pageBorderFill',
  'footNotePr',
  'endNotePr',
  // 보존 객체의 내부 속성 — 객체 자체가 이미 PRESERVE_ONLY/FLATTEN으로 잡혔다.
  'pic',
  'renderingInfo',
  'imgRect',
  'fieldBegin',
  'parameters',
  'equation',
]);

export function matchElementRule(
  localName: string,
  parentLocalName: string | null,
  namespaceUri: string | null,
  knownNamespaces: ReadonlySet<string>,
): ObjectRule | null {
  // `null`(네임스페이스 미선언)도 미지로 본다. 이전 구현은 `!== null` 조건이라
  // 선언이 아예 없는 요소가 미지 가드를 **우회**했다 — 알려진 이름을 쓰되
  // 네임스페이스를 선언하지 않는 것이 가장 값싼 우회였다(리뷰 M-2).
  if (namespaceUri === null || !knownNamespaces.has(namespaceUri)) return UNKNOWN_NAMESPACE_RULE;
  for (const rule of OBJECT_RULES) {
    if (rule.scope !== 'ELEMENT') continue;
    if (rule.localNames && !rule.localNames.includes(localName)) continue;
    if (
      rule.parentLocalNames &&
      (!parentLocalName || !rule.parentLocalNames.includes(parentLocalName))
    ) {
      continue;
    }
    if (!rule.localNames && !rule.parentLocalNames) continue;
    return rule;
  }
  return null;
}
