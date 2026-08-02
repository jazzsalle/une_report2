import type { HwpxFinding, ObjectClassification } from './compatibility';

/**
 * Canonical Document IR (CC-140, ADR-29 D4; design 07 Spec §1.3).
 *
 * The IR deliberately does NOT flatten HWPX XML. It keeps canonical nodes for
 * editing next to an anchor back into the original XML, and every part or
 * construct the engine does not model is preserved verbatim as an
 * UnknownPart — that is what makes "unsupported objects survive edits" a
 * property of the data model rather than a promise.
 *
 * Type ownership (ADR-29 D4): these types are the SOURCE OF TRUTH here in
 * @une/domain so CC-150's API/worker can persist and return IR
 * (document_revision.ir_json / ir_hash) without depending on the HWPX engine.
 * @une/hwpx-engine builds them; it must not redefine them.
 */

/** Anchor into the source XML: part path + element path with 1-based ordinals
 * (ADR-29 D6 — e.g. "Contents/section0.xml#p[17]"). Structural position only;
 * character offsets belong to CC-150's SelectionResolver, not here. */
export type RawXmlAnchor = string;

export interface StyleRef {
  paraPrId: number | null;
  charPrId: number | null;
  numberingId: number | null;
  styleId: number | null;
}

export interface EditState {
  /** Set by CC-150 when a user edits the paragraph; protected from
   * regeneration (CLAUDE.md: user-edited blocks are protected). */
  editedByUser: boolean;
  locked: boolean;
}

export interface RunIR {
  runId: string;
  text: string;
  charPrId: number | null;
  /** Inline controls kept as anchors — never dropped, never interpreted here. */
  controls: RawXmlAnchor[];
}

export interface ParagraphIR {
  paragraphId: string;
  runs: RunIR[];
  styleRef: StyleRef;
  editState: EditState;
  rawXmlAnchor: RawXmlAnchor;
  /** Analyzer output when a role was resolved (OUTLINE_1..n, BODY, TITLE …). */
  styleRole?: string;
  outlineLevel?: number;
  prototypeId?: string;
}

export interface TableCellIR {
  cellId: string;
  rowSpan: number;
  colSpan: number;
  /** Cells contain blocks; at minimum one paragraph (invariant I6). */
  blocks: BlockIR[];
}

export interface TableRowIR {
  rowId: string;
  cells: TableCellIR[];
}

export interface TableIR {
  tableId: string;
  rows: TableRowIR[];
  rawXmlAnchor: RawXmlAnchor;
  prototypeId?: string;
}

export type BlockIR =
  | ({ kind: 'PARAGRAPH' } & ParagraphIR)
  | ({ kind: 'TABLE' } & TableIR)
  /** Structures the engine models only as preserved XML (pictures, OLE,
   * equations, unknown controls). They occupy their position in block order
   * so surrounding edits cannot reorder or drop them. */
  | {
      kind: 'PRESERVED';
      preservedId: string;
      rawXmlAnchor: RawXmlAnchor;
      classification: ObjectClassification;
    };

export interface PageSettings {
  /** Raw page/section properties kept as an anchor — layout is rhwp's job. */
  rawXmlAnchor: RawXmlAnchor;
}

export interface SectionIR {
  sectionId: string;
  /** Source part this section was read from (e.g. 'Contents/section0.xml'). */
  partPath: string;
  blocks: BlockIR[];
  pageSettings: PageSettings;
}

/** A package part the IR does not model. Byte-level preservation lives in the
 * engine's SourcePreservationMap; this records that the part is ACCOUNTED FOR
 * (invariant I4: known parts ∪ unknown parts == every ZIP entry). */
export interface UnknownPart {
  partPath: string;
  contentType: string | null;
  /** SHA-256 of the original entry bytes. */
  hash: string;
}

export interface StyleIndexEntry {
  id: number;
  /** Verbatim attribute map from header.xml — no interpretation, so unknown
   * attributes survive. */
  attributes: Record<string, string>;
}

export interface StyleIndex {
  paraPr: StyleIndexEntry[];
  charPr: StyleIndexEntry[];
  style: StyleIndexEntry[];
  numbering: StyleIndexEntry[];
  bullet: StyleIndexEntry[];
  binData: StyleIndexEntry[];
}

export interface DocumentIR {
  /** IR schema version — bumped when the shape changes so persisted
   * ir_json can be interpreted (CC-150 reads rows written by earlier code). */
  irVersion: '1';
  documentId: string;
  /** Revision this IR belongs to; null until CC-150 creates revisions. */
  revision: string | null;
  /** SHA-256 of the source HWPX package bytes. */
  sourceHash: string;
  sections: SectionIR[];
  styleIndex: StyleIndex;
  unknownParts: UnknownPart[];
  findings: HwpxFinding[];
}
