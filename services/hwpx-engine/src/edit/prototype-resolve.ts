import type { ClonePolicy, PrefixPolicy, StyleRef } from '@une/domain';
import { extractPrefix } from '../analysis/outline-pattern';
import { resolvePrototype, type Prototype } from '../analysis/prototype-registry';
import type { DocumentIndex } from './document-tree';
import { paragraphTextOf } from './selection-resolver';

/**
 * Prototype Resolve — 신규 블록의 서식 결정 (설계 07 §1.7, §1.9 INSERT_BLOCKS).
 *
 * §1.7의 핵심은 "Prototype은 스타일 ID 목록이 아니라 원본문단/표의 재사용 가능한
 * 구조체"라는 것이다. 그래서 이 층이 만드는 것은 **완성된 문단이 아니라 씨앗
 * (seed)** 이다:
 *
 *   - IR 층은 원본 문단의 `styleRef`와 역할·prototypeId만 승계한다.
 *   - 실제 서식 복제(`CLONE_XML`)는 원본 XML fragment를 그대로 베끼는 일이라
 *     **CC-160의 XML Delta Writer 소관**이다. IR에는 `prototypeId`만 남기면
 *     되고, CC-160은 그 ID로 `TemplateProfile.prototypes[].rawXmlAnchor`를 찾아
 *     원본 조각을 복제한다. IR에서 XML을 미리 흉내 내면 §1.7이 경고한
 *     "미지원 속성 손실"이 IR 층에서 발생한다.
 */
export interface AuthoredParagraphSeed {
  readonly styleRef: StyleRef;
  readonly styleRole: string;
  readonly outlineLevel: number | null;
  readonly prototypeId: string;
  readonly clonePolicy: ClonePolicy;
  readonly prefixPolicy: PrefixPolicy;
  /** KEEP_SOURCE_PREFIX에서 새 문단 앞에 붙일 원본 접두사(앞뒤 공백 포함). */
  readonly sourcePrefix: string;
  /** §1.7 폴백 단계 1..5. */
  readonly step: number;
  readonly warning: string | null;
}

const EMPTY_STYLE_REF: StyleRef = Object.freeze({
  paraPrId: null,
  charPrId: null,
  numberingId: null,
  styleId: null,
});

export interface ResolveSeedInput {
  readonly prototypes: readonly Prototype[];
  readonly index: DocumentIndex;
  readonly styleRole: string;
  readonly outlineLevel?: number | null;
  readonly tableContext?: boolean;
}

export function resolveSeed(input: ResolveSeedInput): AuthoredParagraphSeed {
  const resolved = resolvePrototype(input.prototypes, {
    styleRole: input.styleRole,
    outlineLevel: input.outlineLevel ?? null,
    tableContext: input.tableContext ?? false,
  });
  const prototype = resolved.prototype as Prototype;

  // 원본 문단이 아직 문서에 있으면 그 styleRef를 승계한다. §1.7이 "원본 삭제와
  // 무관하게 raw fragment 보존"이라고 한 대로, 원본이 지워졌어도 프로토타입
  // 자체는 유효하다 — 그때는 styleRef를 비우고 CC-160의 XML 복제에 맡긴다.
  const source =
    prototype.sourceParagraphId === null
      ? null
      : input.index.blocks.get(prototype.sourceParagraphId);
  const sourceParagraph = source && source.block.kind === 'PARAGRAPH' ? source.block : null;

  // 원본 문단이 사라져 styleRef가 비는 것은 **말없이 넘어갈 사실이 아니다**:
  // 새 문단이 서식 없이 만들어지고 그 사실이 어디에도 남지 않으면, 사용자는
  // CC-160 저장 이후에야 서식이 빠진 것을 발견한다. 폴백 단계 경고
  // (`resolved.warning`)와는 다른 층의 사실이므로 둘 다 실어 보낸다.
  const missingSource =
    prototype.sourceParagraphId !== null && sourceParagraph === null
      ? `prototype ${prototype.prototypeId}의 원본 문단(${prototype.sourceParagraphId})이 문서에 없어 styleRef를 승계하지 못했습니다`
      : null;

  return {
    styleRef: sourceParagraph ? sourceParagraph.styleRef : EMPTY_STYLE_REF,
    styleRole: prototype.styleRole,
    outlineLevel: prototype.outlineLevel,
    prototypeId: prototype.prototypeId,
    clonePolicy: prototype.clonePolicy,
    prefixPolicy: prototype.prefixPolicy,
    sourcePrefix: sourceParagraph ? prefixOf(paragraphTextOf(sourceParagraph)) : '',
    step: resolved.step,
    warning: resolved.warning ?? missingSource,
  };
}

function prefixOf(text: string): string {
  const parts = extractPrefix(text);
  if (!parts) return '';
  return `${parts.leadingWhitespace}${parts.literalPrefix}${parts.trailingWhitespace}`;
}

/**
 * §1.7 prefixPolicy 적용.
 *
 * - `KEEP_SOURCE_PREFIX`: 원본 문자형 접두사(□/○/-)를 그대로 붙인다. 이미 같은
 *   접두사로 시작하는 텍스트에는 다시 붙이지 않는다(호출자가 접두사까지 써서
 *   보내는 경우가 흔하다).
 * - `REPLACE_TEXT_ONLY`: 텍스트만 넣는다.
 * - `NUMBERING_ENGINE`: 번호는 `paraPr`의 자동번호가 만든다. 문자 접두사를
 *   붙이면 저장 후 "1. 1. 제목"처럼 두 번 찍힌다.
 */
export function applyPrefixPolicy(seed: AuthoredParagraphSeed, text: string): string {
  if (seed.prefixPolicy !== 'KEEP_SOURCE_PREFIX') return text;
  if (seed.sourcePrefix === '' || text.startsWith(seed.sourcePrefix)) return text;
  return `${seed.sourcePrefix}${text}`;
}
