/**
 * Selection model — the CHARACTER layer (CC-150, ADR-30; design 07 §1.8).
 *
 * Three layers exist and must not be mixed (ADR-29 D6 deferred this one to
 * CC-150 on purpose):
 *
 *   L1 structure  `rawXmlAnchor` = partPath#el[n]   — CC-140, immutable
 *                 against the ORIGINAL package (editing never rewrites it)
 *   L2 node       paragraphId / runId / tableId / cellId — frozen at import,
 *                 carried across revisions
 *   L3 character  paragraphId + UTF-16 offset      — this file, valid within
 *                 one revision
 *
 * L3 NEVER references L1. A selection envelope carries L2 ids and offsets
 * only, so the "visual coordinates never enter the contract" rule of §1.8-4
 * is enforced by the type system rather than by convention.
 */

export const SELECTION_KINDS = ['CURSOR', 'TEXT_RANGE', 'BLOCK', 'SECTION', 'TABLE_CELL'] as const;

export type SelectionKind = (typeof SELECTION_KINDS)[number];

/** A character position inside one paragraph. Offsets are UTF-16 code units
 * — fixed by §1.8 for parity with React/JavaScript string indexing. */
export interface TextPosition {
  paragraphId: string;
  /** UTF-16 code unit index into the paragraph's concatenated run text. */
  offset: number;
}

/**
 * What the client sends. Deliberately has NO field for pixel/visual
 * coordinates and NO field for a raw XML anchor (§1.8-4).
 */
export type SelectionEnvelope =
  | { kind: 'CURSOR'; baseRevisionId: string; at: TextPosition }
  | { kind: 'TEXT_RANGE'; baseRevisionId: string; start: TextPosition; end: TextPosition }
  | { kind: 'BLOCK'; baseRevisionId: string; blockIds: string[] }
  | { kind: 'SECTION'; baseRevisionId: string; sectionId: string }
  | {
      kind: 'TABLE_CELL';
      baseRevisionId: string;
      tableId: string;
      cellId: string;
      start?: TextPosition;
      end?: TextPosition;
    };

/** Why a resolved selection differs from what the client sent. Surfaced so
 * the UI can say "your selection was adjusted" instead of silently moving
 * the user's caret. */
export const SELECTION_ADJUSTMENTS = [
  'REVERSED', // start/end were backwards (§1.8-3 forward normalization)
  'SURROGATE_PAIR', // offset fell inside a surrogate pair
  'COMBINING_MARK', // offset split a grapheme cluster
  'FIELD_BOUNDARY', // offset fell inside a fieldBegin/fieldEnd pair
  'ALIAS_REMAPPED', // node id was re-read through the split/merge alias map
] as const;

export type SelectionAdjustment = (typeof SELECTION_ADJUSTMENTS)[number];

/** Cumulative UTF-16 span of one run within its paragraph. CC-160's
 * serializer needs these to map character offsets back onto XML text nodes
 * (§1.8 "Serializer 직전 XML text node offset으로 다시 매핑") — CC-150 only
 * computes them. */
export interface RunSpan {
  runId: string;
  start: number;
  end: number;
}

/** Normalized, validated selection — what ChangeSetExecutor consumes. */
export interface SelectionContext {
  kind: SelectionKind;
  baseRevisionId: string;
  /** Paragraph/block/table ids the selection actually covers, in document
   * order. Every id exists in the base revision. */
  targetIds: string[];
  start?: TextPosition;
  end?: TextPosition;
  runSpans?: RunSpan[];
  /** Empty when the envelope was already canonical. */
  adjustments: SelectionAdjustment[];
}

/**
 * Offset Normalization Contract (ADR-30 D5).
 *
 * The offset space is the concatenation of a paragraph's `RunIR.text` values
 * in run order. Which XML constructs contribute characters is NOT a detail —
 * it is the definition of the space, and a client that counts differently
 * will edit at the wrong position. CC-140 fixed the table below in
 * ir-builder; CC-150 promotes it to a contract so any editor adapter
 * (rhwp included) can be checked against it.
 */
export const OFFSET_CONTRIBUTING_ELEMENTS: Readonly<Record<string, string>> = Object.freeze({
  fwSpace: ' ', // fixed-width space → one ordinary space
  nbSpace: ' ', // non-breaking space keeps its own code point
  tab: '	',
});

/** Elements that occupy NO offset even though they live inside a run.
 * Counting them would shift every later offset in the paragraph. */
export const OFFSET_TRANSPARENT_ELEMENTS: readonly string[] = Object.freeze([
  'lineBreak',
  'hypen', // (sic) HWPX spells it without the 'h'
  'fieldBegin',
  'fieldEnd',
]);

/** True when splitting at `offset` would break a surrogate pair. */
export function splitsSurrogatePair(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return false;
  const high = text.charCodeAt(offset - 1);
  const low = text.charCodeAt(offset);
  return high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff;
}

const COMBINING = /\p{M}/u;

/** True when `offset` sits immediately before a combining mark, i.e. inside
 * a grapheme cluster. */
export function splitsGraphemeCluster(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return false;
  return COMBINING.test(text[offset]);
}

/**
 * Snaps an offset to the nearest legal boundary, reporting what it had to
 * change. Snapping BACKWARD is deliberate: moving a caret earlier can only
 * shrink an edit, while moving it later could swallow a character the user
 * did not select.
 */
export function normalizeOffset(
  text: string,
  offset: number,
): { offset: number; adjustments: SelectionAdjustment[] } {
  const adjustments: SelectionAdjustment[] = [];
  let next = Math.max(0, Math.min(offset, text.length));
  if (splitsSurrogatePair(text, next)) {
    next -= 1;
    adjustments.push('SURROGATE_PAIR');
  }
  while (splitsGraphemeCluster(text, next)) {
    next -= 1;
    if (!adjustments.includes('COMBINING_MARK')) adjustments.push('COMBINING_MARK');
    if (next <= 0) break;
  }
  if (splitsSurrogatePair(text, next)) {
    next -= 1;
    if (!adjustments.includes('SURROGATE_PAIR')) adjustments.push('SURROGATE_PAIR');
  }
  return { offset: next, adjustments };
}
