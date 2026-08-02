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

/** Where an authored node sits relative to an existing one. Expressed against
 * STABLE IDS, never against a raw XML anchor — an authored node has no anchor
 * at all. Lives here (not in change-set.ts) because it is an IR concept; the
 * ChangeSet vocabulary re-exports it. */
export interface BlockAnchor {
  relation: 'BEFORE' | 'AFTER' | 'FIRST_CHILD' | 'LAST_CHILD';
  /** Stable id of the reference node (paragraph/table/cell). */
  ref: string;
}

/** Where a node came from. */
export type NodeOrigin = 'SOURCE' | 'AUTHORED';

/**
 * Origin and its anchor evidence, as a DISCRIMINATED UNION (CC-150, ADR-30 D3).
 *
 * The point is that "a node with neither an anchor nor a hint" does not
 * compile: invariant I9 is enforced by the type checker before any runtime
 * check runs. SOURCE nodes point back into the original XML; AUTHORED nodes
 * carry the placement CC-160's delta writer needs, because inferring it from
 * IR order later would turn §1.10-3 (raw fragment relative order) from data
 * into trust in an algorithm.
 */
export type NodeProvenance =
  | { origin: 'SOURCE'; rawXmlAnchor: RawXmlAnchor; anchorHint?: undefined }
  | { origin: 'AUTHORED'; rawXmlAnchor?: undefined; anchorHint: BlockAnchor };

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

export interface ParagraphCore {
  paragraphId: string;
  runs: RunIR[];
  styleRef: StyleRef;
  editState: EditState;
  /** Analyzer output when a role was resolved (OUTLINE_1..n, BODY, TITLE …). */
  styleRole?: string;
  outlineLevel?: number;
  prototypeId?: string;
}

export type ParagraphIR = ParagraphCore & NodeProvenance;

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

export interface TableCore {
  tableId: string;
  rows: TableRowIR[];
  prototypeId?: string;
}

export type TableIR = TableCore & NodeProvenance;

export type BlockIR =
  | ({ kind: 'PARAGRAPH' } & ParagraphIR)
  | ({ kind: 'TABLE' } & TableIR)
  /** Structures the engine models only as preserved XML (pictures, OLE,
   * equations, unknown controls). They occupy their position in block order
   * so surrounding edits cannot reorder or drop them. */
  | PreservedBlockIR;

/** A preserved object can never be AUTHORED: it is a placeholder for original
 * bytes, and an editor cannot create one. It therefore does NOT use
 * NodeProvenance — `origin` is pinned to SOURCE. */
export interface PreservedBlockIR {
  kind: 'PRESERVED';
  origin: 'SOURCE';
  preservedId: string;
  rawXmlAnchor: RawXmlAnchor;
  classification: ObjectClassification;
}

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
  /** IR schema version. v2 adds NodeProvenance (CC-150, ADR-30 D3); v1 rows
   * are lifted on read. Bumped when the shape changes so persisted ir_json
   * stays interpretable by code written before the change. */
  irVersion: '1' | '2';
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
