import type { ClonePolicy, PrefixPolicy, TemplateProfilePrototype } from '@une/domain';
import type { ParagraphSource, TableSource } from '../ir/ir-builder';
import { sourceAnchor } from '../ir/anchors';
import { stableId } from '../ir/stable-id';
import { elementsOf, type XmlElement } from '../package/xml';

/**
 * ParagraphPrototypeRegistry (설계 07 §1.7).
 *
 * "Prototype은 스타일 ID 목록이 아니라 원본문단/표의 재사용 가능한 구조체이다.
 * 기본 정책은 CLONE_XML이며, 안전하게 재구성 가능한 단순 문단만 CLONE_IR 또는
 * REBUILD_ALLOWED를 허용한다."
 *
 * 기본값을 CLONE_XML로 두는 이유는 §1.7 표의 "미지원 속성 손실 방지"다.
 * IR이 모델링하지 않는 속성(글자 겹침, 강조점, 사용자 정의 컨트롤 …)은
 * 재구성하는 순간 사라진다. 그러므로 **재구성 허용이 예외**여야 한다.
 */

/**
 * 정책 유니온은 `@une/domain`이 정본이다(ADR-29 D4, 리뷰 M-1).
 * CC-150이 `template_profile.profile_json`을 다룰 때 엔진에 의존하지 않아야
 * 하므로 어휘가 도메인에 있어야 하고, 엔진이 사본을 들면 두 벌이 갈라진다.
 * 여기서는 기존 임포트 경로를 유지하기 위해 다시 내보내기만 한다.
 */
export type { ClonePolicy, PrefixPolicy };

/**
 * Prototype **타입도** 도메인이 정본이다(ADR-29 D4).
 *
 * 같은 모양을 엔진에서 다시 선언해 두었더니 API가 두 타입을 잇느라
 * `as unknown as readonly Prototype[]` 이중 캐스트를 써야 했고, 그 캐스트는
 * 나중에 한쪽에 필드가 늘어도 컴파일 오류를 내지 않는다 — 즉 "정본이 하나"라는
 * 규칙을 지키는 척하면서 실제로는 드리프트를 숨긴다. 여기서는 도메인 타입을
 * 읽기 전용으로 좁힌 별칭만 둔다.
 */
export type Prototype = Readonly<TemplateProfilePrototype>;

export interface ResolveRequest {
  readonly styleRole: string;
  readonly outlineLevel?: number | null;
  readonly tableContext?: boolean;
}

export interface ResolveResult {
  readonly prototype: Prototype | null;
  /** 1..5. §1.7 resolvePrototype 폴백 단계 번호. */
  readonly step: number;
  readonly warning: string | null;
}

/**
 * SYSTEM_SAFE_DEFAULT의 앵커 센티널. 원본 문단이 없다는 사실을 **값으로**
 * 말한다. Part 경로 자리에 괄호 표기를 쓰므로 실제 Part와 충돌하지 않는다.
 */
export const SYSTEM_DEFAULT_ANCHOR = '(system-default)#none[1]';

export const SYSTEM_SAFE_DEFAULT: Prototype = Object.freeze({
  prototypeId: 'PROTO-SYSTEM-SAFE-DEFAULT',
  sourceParagraphId: null,
  sourceTableId: null,
  styleRole: 'BODY',
  outlineLevel: null,
  tableContext: false,
  clonePolicy: 'REBUILD_ALLOWED' as ClonePolicy,
  prefixPolicy: 'REPLACE_TEXT_ONLY' as PrefixPolicy,
  fallbackChain: [],
  // 비어 있지 않은 센티널이다(리뷰 m-6). 빈 문자열은 (1) 계약 스키마의
  // `minLength: 1`/`rawXmlAnchor` 패턴을 위반하고, (2) "앵커가 없음"과
  // "앵커 계산에 실패함"을 구별할 수 없게 만든다. 이 값은 어떤 Part도 가리키지
  // 않으므로 앵커 역참조(I2)에서 즉시 걸린다 — 그것이 의도다.
  rawXmlAnchor: SYSTEM_DEFAULT_ANCHOR,
  immutable: true as const,
  evidence: '§1.7 5) SYSTEM_SAFE_DEFAULT — 원본 근거 없음',
});

/**
 * 단순 문단 판정: run이 hp:t만 갖고(인라인 컨트롤 0), 문자 속성이 하나이며,
 * 표/그림/필드를 포함하지 않는다. 이 조건에서만 IR 재구성이 손실 없다.
 */
function isSimpleParagraph(element: XmlElement, source: ParagraphSource): boolean {
  if (source.paragraph.runs.some((run) => run.controls.length > 0)) return false;
  const charPrIds = new Set(source.paragraph.runs.map((run) => run.charPrId));
  if (charPrIds.size > 1) return false;
  for (const run of elementsOf(element)) {
    if (run.localName === 'linesegarray') continue;
    if (run.localName !== 'run') return false;
    for (const child of elementsOf(run)) {
      if (child.localName !== 't') return false;
      if (elementsOf(child).length > 0) return false;
    }
  }
  return true;
}

export interface BuildPrototypesInput {
  readonly roles: ReadonlyMap<string, { styleRole: string; outlineLevel: number | null }>;
  readonly paragraphs: readonly ParagraphSource[];
  readonly tables: readonly TableSource[];
  readonly hasLiteralPrefix: (paragraphId: string) => boolean;
}

/**
 * §1.5-6 "확정된 역할마다 원본문단 또는 표를 불변 Prototype으로 등록한다."
 * 역할마다 **최초 등장 문단**을 원본으로 삼는다 — 뒤쪽 문단은 이미 편집된
 * 사본일 가능성이 높다.
 */
export function buildPrototypes(input: BuildPrototypesInput): Prototype[] {
  const chosen = new Map<string, ParagraphSource>();
  for (const source of input.paragraphs) {
    const role = input.roles.get(source.paragraph.paragraphId);
    if (!role) continue;
    const key = `${role.styleRole}|${role.outlineLevel ?? ''}|${source.tableContext !== null}`;
    const existing = chosen.get(key);
    if (!existing || source.documentOrder < existing.documentOrder) chosen.set(key, source);
  }

  const prototypes: Prototype[] = [];
  for (const [key, source] of [...chosen.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const role = input.roles.get(source.paragraph.paragraphId) as {
      styleRole: string;
      outlineLevel: number | null;
    };
    const simple = isSimpleParagraph(source.element, source);
    const hasPrefix = input.hasLiteralPrefix(source.paragraph.paragraphId);
    const clonePolicy: ClonePolicy = !simple
      ? 'CLONE_XML'
      : hasPrefix
        ? 'CLONE_IR'
        : 'REBUILD_ALLOWED';
    const prefixPolicy: PrefixPolicy = hasPrefix
      ? source.paragraph.styleRef.numberingId !== null
        ? 'NUMBERING_ENGINE'
        : 'KEEP_SOURCE_PREFIX'
      : 'REPLACE_TEXT_ONLY';
    prototypes.push({
      prototypeId: stableId(
        'PROTO',
        key,
        sourceAnchor(source.paragraph, source.paragraph.paragraphId),
      ),
      sourceParagraphId: source.paragraph.paragraphId,
      sourceTableId: null,
      styleRole: role.styleRole,
      outlineLevel: role.outlineLevel,
      tableContext: source.tableContext !== null,
      clonePolicy,
      prefixPolicy,
      fallbackChain: fallbackChainFor(role.styleRole, role.outlineLevel),
      rawXmlAnchor: sourceAnchor(source.paragraph, source.paragraph.paragraphId),
      immutable: true,
      evidence:
        `simpleParagraph=${simple} literalPrefix=${hasPrefix} ` +
        `numberingId=${source.paragraph.styleRef.numberingId ?? -1} :: §1.7 clonePolicy 기본 CLONE_XML`,
    });
  }

  // 표 기본형 — 첫 표를 TABLE_DEFAULT 원본으로 등록한다.
  const firstTable = [...input.tables].sort((a, b) =>
    sourceAnchor(a.table, a.table.tableId).localeCompare(sourceAnchor(b.table, b.table.tableId)),
  )[0];
  if (firstTable) {
    prototypes.push({
      prototypeId: stableId(
        'PROTO',
        'TABLE_DEFAULT',
        sourceAnchor(firstTable.table, firstTable.table.tableId),
      ),
      sourceParagraphId: null,
      sourceTableId: firstTable.table.tableId,
      styleRole: 'TABLE_DEFAULT',
      outlineLevel: null,
      tableContext: true,
      clonePolicy: 'CLONE_XML',
      prefixPolicy: 'REPLACE_TEXT_ONLY',
      fallbackChain: ['BODY_DEFAULT', 'SYSTEM_SAFE_DEFAULT'],
      rawXmlAnchor: sourceAnchor(firstTable.table, firstTable.table.tableId),
      immutable: true,
      evidence: `rows=${firstTable.table.rows.length} :: §1.7 표는 항상 CLONE_XML`,
    });
  }

  return prototypes;
}

function fallbackChainFor(styleRole: string, outlineLevel: number | null): string[] {
  const chain: string[] = [];
  if (outlineLevel !== null) {
    chain.push(`${styleRole}@${outlineLevel}`);
    if (outlineLevel > 1) chain.push(`${styleRole}@${outlineLevel - 1}`);
    chain.push(`${styleRole}@${outlineLevel + 1}`);
  } else {
    chain.push(styleRole);
  }
  chain.push('BODY_DEFAULT', 'SYSTEM_SAFE_DEFAULT');
  return chain;
}

/**
 * §1.7 resolvePrototype 폴백 5단계.
 *   1) exact(styleRole, outlineLevel, tableContext)
 *   2) same role without tableContext
 *   3) nearest outline level in same family
 *   4) BODY_DEFAULT
 *   5) SYSTEM_SAFE_DEFAULT + warning
 */
export function resolvePrototype(
  prototypes: readonly Prototype[],
  request: ResolveRequest,
): ResolveResult {
  const level = request.outlineLevel ?? null;
  const tableContext = request.tableContext ?? false;

  const exact = prototypes.find(
    (prototype) =>
      prototype.styleRole === request.styleRole &&
      prototype.outlineLevel === level &&
      prototype.tableContext === tableContext,
  );
  if (exact) return { prototype: exact, step: 1, warning: null };

  const sameRole = prototypes.find(
    (prototype) => prototype.styleRole === request.styleRole && prototype.outlineLevel === level,
  );
  if (sameRole) return { prototype: sameRole, step: 2, warning: null };

  if (level !== null) {
    const family = prototypes
      .filter(
        (prototype) => prototype.styleRole === request.styleRole && prototype.outlineLevel !== null,
      )
      .sort(
        (a, b) =>
          Math.abs((a.outlineLevel as number) - level) -
            Math.abs((b.outlineLevel as number) - level) ||
          (a.outlineLevel as number) - (b.outlineLevel as number),
      );
    if (family[0]) {
      return {
        prototype: family[0],
        step: 3,
        warning: `outlineLevel ${level} 원본이 없어 ${family[0].outlineLevel}로 대체했습니다`,
      };
    }
  }

  const body = prototypes.find((prototype) => prototype.styleRole === 'BODY');
  if (body) {
    return {
      prototype: body,
      step: 4,
      warning: `${request.styleRole} 원본이 없어 BODY_DEFAULT로 대체했습니다`,
    };
  }

  return {
    prototype: SYSTEM_SAFE_DEFAULT,
    step: 5,
    warning: `${request.styleRole} 원본이 없어 SYSTEM_SAFE_DEFAULT를 사용합니다 (서식 손실 가능)`,
  };
}
