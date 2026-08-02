import type { OutlinePatternKind } from '@une/domain';
import { stableId } from '../ir/stable-id';
import type { HeaderIndex } from '../ir/header-index';
import type { ParagraphSource } from '../ir/ir-builder';

/**
 * OutlinePatternAnalyzer (설계 07 §1.6 6단계).
 *
 * 핵심 제약: **앞 공백을 trim하지 않는다.** literalPrefix / leadingWhitespace /
 * trailingWhitespace / paragraph indent를 각각 따로 저장한다. 실 코퍼스에서
 * 확인된 형태가 `"□ 기상현황"`, `"  ○ (기상특보) …"`, `"   ※ (동부) …"`처럼
 * **앞 공백 자체가 계층 신호**이기 때문이다. trim하면 ○와 ※가 같은 층으로
 * 뭉개지고, Prototype Clone이 원본 들여쓰기를 잃는다(§1.6 샘플 검증 기준).
 *
 * 패턴 동일성 키 = (literalPrefix, leadingWhitespace, marginLeft, marginIntent).
 * 같은 기호라도 앞 공백/들여쓰기가 다르면 **다른 패턴**이다.
 */

/** 종류 유니온은 `@une/domain`이 정본이다(ADR-29 D4, 리뷰 M-1). */
export type { OutlinePatternKind };

/** §1.6-2 문자형 prefix 후보. 실 코퍼스 관측(□ ○ ㅇ ※ -)을 포함한다. */
const SYMBOL_PREFIX = '[□■◆◇○◯ㅇ●◦▪▫※·∙▶▷☞◈▣＊*+\\-–—―‒]';
/** 숫자·한글·괄호형. 뒤에 공백이 와야 접두사로 인정한다(예: "6.30"은 제외). */
const ALPHANUMERIC_PREFIX = '(?:\\((?:\\d{1,2}|[가-힣])\\)|(?:\\d{1,2}|[가-힣])[.)])';
const CIRCLED_PREFIX = '[\\u2460-\\u2473\\u3260-\\u327B]';
/** space / tab / NBSP / 전각 공백. HWP 문서에 전각 공백이 흔하다. */
const WHITESPACE_CLASS = '[ \\t\\u00A0\\u3000]';

const SYMBOL_RE = new RegExp(
  `^(${WHITESPACE_CLASS}*)(${SYMBOL_PREFIX}|${CIRCLED_PREFIX})(${WHITESPACE_CLASS}*)`,
  'u',
);
const ALPHANUMERIC_RE = new RegExp(
  `^(${WHITESPACE_CLASS}*)(${ALPHANUMERIC_PREFIX})(${WHITESPACE_CLASS}+)`,
  'u',
);

export interface PrefixParts {
  readonly leadingWhitespace: string;
  readonly literalPrefix: string;
  readonly trailingWhitespace: string;
  readonly remainderLength: number;
}

/** §1.6-2/-3. trim하지 않고 세 조각을 분리해 돌려준다. */
export function extractPrefix(text: string): PrefixParts | null {
  const match = SYMBOL_RE.exec(text) ?? ALPHANUMERIC_RE.exec(text);
  if (!match) return null;
  return {
    leadingWhitespace: match[1],
    literalPrefix: match[2],
    trailingWhitespace: match[3],
    remainderLength: text.length - match[0].length,
  };
}

export interface OutlinePatternTransition {
  readonly toPatternId: string;
  readonly count: number;
}

export interface OutlinePattern {
  readonly patternId: string;
  readonly kind: OutlinePatternKind;
  readonly literalPrefix: string;
  readonly leadingWhitespace: string;
  readonly trailingWhitespace: string;
  readonly indent: { readonly marginLeft: number; readonly marginIntent: number };
  readonly paraPrIds: readonly number[];
  readonly outlineLevel: number;
  readonly occurrences: number;
  readonly firstDocumentOrder: number;
  readonly transitions: readonly OutlinePatternTransition[];
  /** §1.6-6 상충하는 level·강조기호 → 사용자 확인 항목. */
  readonly confirmRequired: boolean;
  readonly conflicts: readonly string[];
}

export interface OutlineAssignment {
  readonly paragraphId: string;
  readonly patternId: string;
  readonly outlineLevel: number;
}

export interface OutlineAnalysis {
  readonly patterns: readonly OutlinePattern[];
  readonly assignments: readonly OutlineAssignment[];
  readonly warnings: readonly string[];
}

interface Accumulator {
  key: string;
  kind: OutlinePatternKind;
  literalPrefix: string;
  leadingWhitespace: string;
  trailingWhitespace: string;
  marginLeft: number;
  marginIntent: number;
  paraPrIds: Set<number>;
  occurrences: number;
  firstDocumentOrder: number;
  documentOrders: number[];
  transitions: Map<string, number>;
}

export function paragraphText(source: ParagraphSource): string {
  return source.paragraph.runs.map((run) => run.text).join('');
}

export function analyzeOutlinePatterns(
  paragraphs: readonly ParagraphSource[],
  headerIndex: HeaderIndex,
): OutlineAnalysis {
  const accumulators = new Map<string, Accumulator>();
  const perParagraph: Array<{ source: ParagraphSource; key: string }> = [];
  const warnings: string[] = [];

  for (const source of paragraphs) {
    const paraPrId = source.paragraph.styleRef.paraPrId;
    const detail = paraPrId === null ? undefined : headerIndex.paraPr.get(paraPrId);
    const text = paragraphText(source);

    // §1.6-1 자동번호 검사가 먼저다. heading type이 살아 있으면 문자형
    // prefix가 없어도 개요다.
    const headingType = detail?.headingType ?? 'NONE';
    const autoNumbering = headingType === 'NUMBER' || headingType === 'OUTLINE';
    const prefix = extractPrefix(text);
    if (!autoNumbering && !prefix) continue;
    if (text.trim().length === 0) continue;

    const kind: OutlinePatternKind = autoNumbering
      ? headingType === 'OUTLINE'
        ? 'OUTLINE_PROPERTY'
        : 'AUTO_NUMBERING'
      : 'LITERAL_PREFIX';
    const literalPrefix = prefix?.literalPrefix ?? `@heading:${headingType}`;
    const leadingWhitespace = prefix?.leadingWhitespace ?? '';
    const trailingWhitespace = prefix?.trailingWhitespace ?? '';
    const marginLeft = detail?.marginLeft ?? 0;
    const marginIntent = detail?.marginIntent ?? 0;
    const key = [
      kind,
      JSON.stringify(literalPrefix),
      JSON.stringify(leadingWhitespace),
      marginLeft,
      marginIntent,
    ].join('|');

    let accumulator = accumulators.get(key);
    if (!accumulator) {
      accumulator = {
        key,
        kind,
        literalPrefix,
        leadingWhitespace,
        trailingWhitespace,
        marginLeft,
        marginIntent,
        paraPrIds: new Set<number>(),
        occurrences: 0,
        firstDocumentOrder: source.documentOrder,
        documentOrders: [],
        transitions: new Map<string, number>(),
      };
      accumulators.set(key, accumulator);
    }
    if (paraPrId !== null) accumulator.paraPrIds.add(paraPrId);
    accumulator.occurrences += 1;
    accumulator.documentOrders.push(source.documentOrder);
    if (accumulator.trailingWhitespace !== trailingWhitespace) {
      // 같은 패턴인데 기호 뒤 공백이 흔들린다 → §1.6-6 확인 대상.
      accumulator.trailingWhitespace = trailingWhitespace;
    }
    perParagraph.push({ source, key });
  }

  // §1.6-4 계층 추론: (좌여백, 기호 앞 공백 길이) 오름차순.
  //
  // `hc:intent`(내어쓰기)를 들여쓰기 합에 넣으면 안 된다 — 실 코퍼스에서 이 값은
  // 음수(hanging indent, 줄바꿈된 둘째 줄용)이고 좌여백은 전부 0이라, 합으로
  // 정렬하면 ※(-6962)가 □(-5212)보다 앞서 **계층이 뒤집힌다**. 실제로 층을
  // 가르는 신호는 §1.6-3이 따로 저장하라고 한 **기호 앞 공백**이다
  // (□=1칸, ○=2칸, ―=3칸, ※=5칸). 그래서 (marginLeft, leadingWhitespace.length)를
  // 층 키로 쓰고 intent는 패턴 속성으로만 보존한다.
  const ordered = [...accumulators.values()].sort(
    (a, b) =>
      a.marginLeft - b.marginLeft ||
      a.leadingWhitespace.length - b.leadingWhitespace.length ||
      a.firstDocumentOrder - b.firstDocumentOrder,
  );
  const levelByKey = new Map<string, number>();
  let level = 0;
  let previousLevelKey: string | null = null;
  for (const accumulator of ordered) {
    const levelKey = `${accumulator.marginLeft}|${accumulator.leadingWhitespace.length}`;
    if (levelKey !== previousLevelKey) level += 1;
    previousLevelKey = levelKey;
    levelByKey.set(accumulator.key, level);
  }

  // §1.6-5 반복 검증: 부모→자식 전이 집계.
  const sortedParagraphs = [...perParagraph].sort(
    (a, b) => a.source.documentOrder - b.source.documentOrder,
  );
  for (let i = 0; i + 1 < sortedParagraphs.length; i += 1) {
    const from = accumulators.get(sortedParagraphs[i].key);
    const toKey = sortedParagraphs[i + 1].key;
    if (!from) continue;
    from.transitions.set(toKey, (from.transitions.get(toKey) ?? 0) + 1);
  }

  const patternIdByKey = new Map<string, string>();
  for (const accumulator of ordered) {
    patternIdByKey.set(
      accumulator.key,
      stableId('PAT', accumulator.kind, accumulator.literalPrefix, accumulator.key),
    );
  }

  const patterns: OutlinePattern[] = ordered.map((accumulator) => {
    const conflicts: string[] = [];
    if (accumulator.paraPrIds.size > 1) {
      conflicts.push(
        `동일 패턴이 서로 다른 paraPr ${[...accumulator.paraPrIds].join(',')}를 씁니다`,
      );
    }
    if (accumulator.occurrences === 1) {
      conflicts.push('반복 근거가 1회뿐입니다');
    }
    return {
      patternId: patternIdByKey.get(accumulator.key) as string,
      kind: accumulator.kind,
      literalPrefix: accumulator.literalPrefix,
      leadingWhitespace: accumulator.leadingWhitespace,
      trailingWhitespace: accumulator.trailingWhitespace,
      indent: { marginLeft: accumulator.marginLeft, marginIntent: accumulator.marginIntent },
      paraPrIds: [...accumulator.paraPrIds].sort((a, b) => a - b),
      outlineLevel: levelByKey.get(accumulator.key) ?? 1,
      occurrences: accumulator.occurrences,
      firstDocumentOrder: accumulator.firstDocumentOrder,
      transitions: [...accumulator.transitions.entries()]
        .map(([toKey, count]) => ({
          toPatternId: patternIdByKey.get(toKey) ?? toKey,
          count,
        }))
        .sort((a, b) => a.toPatternId.localeCompare(b.toPatternId)),
      confirmRequired: conflicts.length > 0,
      conflicts,
    };
  });

  for (const pattern of patterns) {
    if (pattern.confirmRequired) {
      warnings.push(
        `개요 패턴 level=${pattern.outlineLevel} 확인 필요: ${pattern.conflicts.join('; ')}`,
      );
    }
  }

  const assignments: OutlineAssignment[] = sortedParagraphs.map((item) => ({
    paragraphId: item.source.paragraph.paragraphId,
    patternId: patternIdByKey.get(item.key) as string,
    outlineLevel: levelByKey.get(item.key) ?? 1,
  }));

  return { patterns, assignments, warnings };
}
