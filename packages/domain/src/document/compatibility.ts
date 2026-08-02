/**
 * HWPX compatibility vocabulary — TWO LAYERS (CC-140, ADR-29 D2).
 *
 * The design baseline carries two vocabularies that are NOT versions of each
 * other; they sit at different levels and roll up:
 *
 * - OBJECT level  (ADR v1.1 §8.4): how ONE object may be handled — the table
 *   there fixes edit permission, save policy, and user display per grade.
 * - DOCUMENT level (ADR v1.1 §8.6 G15-1, Spec §1.5): the analysis verdict for
 *   a whole document/template.
 *
 * The link between them is also in the baseline (Spec §1.4 HWPX-1004:
 * "미지원 객체 존재 → LIMITED + 원문 보존"), implemented as `rollUpVerdict`.
 *
 * Lower-priority design documents use variants (FULL, SUPPORTED) that are
 * deliberately NOT representable here — ADR-29 D2 keeps the mapping table but
 * the code admits only these two unions.
 */

/** Object handling grade (ADR v1.1 §8.4). Mirrors the vocabulary CLAUDE.md
 * fixes; the type also lives in @une/hwpx-engine's contract for callers that
 * only consume the engine. */
export const HWPX_OBJECT_CLASSES = [
  'NATIVE_EDIT',
  'PRESERVE_ONLY',
  'FLATTEN_EXPORT_ONLY',
  'REJECT',
] as const;

export type HwpxObjectClass = (typeof HWPX_OBJECT_CLASSES)[number];

/** Document analysis verdict (ADR v1.1 §8.6 G15-1; template_profile.analysis_status). */
export const DOCUMENT_COMPATIBILITY_VERDICTS = ['AUTO', 'CONFIRM', 'LIMITED', 'REJECT'] as const;

export type DocumentCompatibilityVerdict = (typeof DOCUMENT_COMPATIBILITY_VERDICTS)[number];

/** Stable reader/analysis finding codes (Spec §1.4 table). */
export const HWPX_FINDING_CODES = [
  'HWPX-1001', // ZIP/HWPX signature mismatch, path traversal, duplicate entry, DTD present
  'HWPX-1002', // decompression limits exceeded
  'HWPX-1003', // required part missing
  'HWPX-1004', // unsupported object present
  'HWPX-1005', // broken style/numbering reference
] as const;

export type HwpxFindingCode = (typeof HWPX_FINDING_CODES)[number];

export type HwpxFindingSeverity = 'FATAL' | 'DEGRADING' | 'INFO';

export interface HwpxFinding {
  code: HwpxFindingCode;
  severity: HwpxFindingSeverity;
  /** Where the finding was observed: a package part path or a rawXmlAnchor. */
  locator: string;
  detail: string;
}

/**
 * Which layer a classification is about (CC-140 measurement finding).
 *
 * - `PART`: a package part (Preview/*, META-INF/*, Scripts/*, BinData/*).
 *   EVERY HWPX carries such parts, and the IR preserves them byte-for-byte
 *   (invariants I4/I5), so they must not degrade the document verdict.
 * - `ELEMENT`: a construct inside the document body — what §8.4's "편집 허용 /
 *   사용자 표시(제한 아이콘)" columns actually describe.
 */
export type ClassificationScope = 'PART' | 'ELEMENT';

/** One object's classification with the evidence G15-1 requires ("판정과 근거
 * 재현") — a grade without a reproducible reason is not acceptable. */
export interface ObjectClassification {
  objectClass: HwpxObjectClass;
  scope: ClassificationScope;
  /** Rule id from the classification table (e.g. 'OBJ-PIC-BINDATA'). */
  reasonCode: string;
  locator: string;
  evidence: string;
  /**
   * Does this object CAP the document verdict at LIMITED (roll-up rule 3)?
   *
   * The grade axis and the cap axis are deliberately separate (CC-140 review
   * M-3). §8.4's grades are promises about handling — `NATIVE_EDIT` means
   * "parsed, rendered, edited and re-saved, verified", and CC-160 branches its
   * save policy on the grade (ADR-29 D11). Section layout properties
   * (hp:colPr, hp:pagePr …) and whitespace constructs (hp:fwSpace, hp:nbSpace
   * …) are NOT parsed into the IR — they survive as anchors plus preserved
   * bytes — so calling them `NATIVE_EDIT` would be a false promise and would
   * hand un-parsed XML to a "minimal re-save" path.
   *
   * They are nonetheless not a reason to tell the user "this document can only
   * be opened in preserve mode": §8.4's "사용자 표시" column marks them
   * normal. So they stay `PRESERVE_ONLY` and set `capsVerdict = false`.
   *
   * Default for every other object is `true`.
   */
  capsVerdict: boolean;
}

/**
 * An element the classification table did not match (CC-140 review M-2).
 *
 * Dropping unmatched elements silently made the "catch-all hit count is zero"
 * guard useless: a hole that classifies nothing looks exactly like a table
 * that classifies everything correctly. Unmatched elements are therefore
 * carried out of the classifier as data so tests can assert on them.
 */
export interface UnclassifiedElement {
  localName: string;
  parentLocalName: string | null;
  /** rawXmlAnchor of the element — resolvable back to the source XML. */
  anchor: string;
}

/** Confidence weights fixed by Spec §1.5. Exported so the analyzer cannot
 * drift from the baseline silently. */
export const CONFIDENCE_WEIGHTS = {
  styleConsistency: 0.3,
  prefixConsistency: 0.2,
  indentHierarchy: 0.15,
  repetitionEvidence: 0.15,
  positionEvidence: 0.1,
  semanticHint: 0.1,
} as const;

export type ConfidenceComponents = Record<keyof typeof CONFIDENCE_WEIGHTS, number>;

export const AUTO_CONFIDENCE_THRESHOLD = 0.85;
export const CONFIRM_CONFIDENCE_THRESHOLD = 0.6;

export function computeConfidence(components: ConfidenceComponents): number {
  let total = 0;
  for (const [key, weight] of Object.entries(CONFIDENCE_WEIGHTS)) {
    const value = components[key as keyof ConfidenceComponents];
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(`confidence component ${key} must be within [0,1], got ${value}`);
    }
    total += value * weight;
  }
  // Weights sum to 1.0; round to 4 decimals so the value is stable across
  // platforms and reproducible in golden evidence.
  return Math.round(total * 10000) / 10000;
}

export interface RollUpInput {
  objects: readonly ObjectClassification[];
  findings: readonly HwpxFinding[];
  confidence: number;
}

/**
 * Object grades + findings + confidence → document verdict (ADR-29 D2 rules
 * 1~4). Order matters: fatal conditions win over confidence, and the presence
 * of a non-natively-editable object CAPS the verdict at LIMITED regardless of
 * how confident the template analysis is.
 */
export function rollUpVerdict(input: RollUpInput): DocumentCompatibilityVerdict {
  // Rule 1: any REJECT object rejects the document (§8.4 "열기/편집 거부").
  if (input.objects.some((object) => object.objectClass === 'REJECT')) return 'REJECT';
  // Rule 2: fatal findings (missing required part, fatal dangling reference).
  if (input.findings.some((finding) => finding.severity === 'FATAL')) return 'REJECT';
  // Rule 3: unsupported objects cap the verdict at LIMITED (HWPX-1004) —
  // ELEMENT scope only, and only when the object actually caps. Measured on
  // the real corpus (CC-140): every HWPX carries PRESERVE_ONLY package parts
  // (Preview/*, META-INF/container.rdf, Scripts/*), so capping on PART scope
  // would make AUTO unreachable for 100% of inputs and G15-1's "reproduce the
  // AUTO verdict" unsatisfiable by construction. Package parts are covered by
  // I4 (accounted for) + I5 (byte-preserved) instead — see ADR-29 D2
  // amendment. `capsVerdict` carries the second exemption (review M-3):
  // section layout properties and whitespace constructs are preserved rather
  // than parsed, yet §8.4 marks them normal for the user, so they keep the
  // honest PRESERVE_ONLY grade while opting out of the cap.
  const capped = input.objects.some(
    (object) =>
      object.scope === 'ELEMENT' &&
      object.capsVerdict &&
      (object.objectClass === 'PRESERVE_ONLY' || object.objectClass === 'FLATTEN_EXPORT_ONLY'),
  );
  if (capped) return 'LIMITED';
  // Rule 4: confidence bands (Spec §1.5).
  if (input.confidence >= AUTO_CONFIDENCE_THRESHOLD) return 'AUTO';
  if (input.confidence >= CONFIRM_CONFIDENCE_THRESHOLD) return 'CONFIRM';
  return 'LIMITED';
}
