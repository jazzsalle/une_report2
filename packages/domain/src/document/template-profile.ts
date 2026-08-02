import type {
  ConfidenceComponents,
  DocumentCompatibilityVerdict,
  HwpxObjectClass,
  ObjectClassification,
  UnclassifiedElement,
} from './compatibility';
import type { RawXmlAnchor } from './document-ir';

/**
 * TemplateProfile — the STABLE EXTERNAL REPRESENTATION of a template analysis
 * (CC-140, ADR-29 D5; design 07 Spec §1.5~§1.7).
 *
 * Type ownership follows ADR-29 D4, same as the Document IR: the shape lives
 * here in `@une/domain` so CC-150 can persist and return
 * `template_profile.profile_json` without depending on `@une/hwpx-engine`.
 * The engine's `toTemplateProfile()` projects its internal analysis result
 * onto this shape; the engine's own types stay free to change.
 *
 * ## Why the vocabularies live here
 *
 * The enums below are the SOURCE OF TRUTH and are the engine's measured
 * unions, not a reduced set. `StaticRegionKind` in particular has eight
 * members because the detector really produces eight kinds; an external
 * representation that can only express five would silently drop
 * PAGE_NUMBER/NOTE/COVER_TITLE/FIXED_PHRASE/APPROVAL_BLOCK regions — exactly
 * the "생성이 건드리면 안 되는 자리" the profile exists to protect.
 *
 * ## What is deliberately NOT here
 *
 * - per-paragraph role assignments: they belong on `ParagraphIR.styleRole` /
 *   `outlineLevel` (document-ir.ts), which is where CC-150 reads them. Copying
 *   them into the profile would create a second, divergable copy.
 * - findings: `DocumentIR.findings` is the carrier. The profile records the
 *   verdict those findings produced, not the findings themselves.
 */

/** §1.5 staticRegions — every kind the detector can emit. */
export const STATIC_REGION_KINDS = [
  'HEADER',
  'FOOTER',
  'PAGE_NUMBER',
  'NOTE',
  'FIELD',
  'APPROVAL_BLOCK',
  'COVER_TITLE',
  'FIXED_PHRASE',
] as const;

export type StaticRegionKind = (typeof STATIC_REGION_KINDS)[number];

/** §1.7 — CLONE_XML is the default; relaxing it must be earned per prototype. */
export const CLONE_POLICIES = ['CLONE_XML', 'CLONE_IR', 'REBUILD_ALLOWED'] as const;

export type ClonePolicy = (typeof CLONE_POLICIES)[number];

/** §1.7 — how a cloned prototype's literal prefix is treated on reuse. */
export const PREFIX_POLICIES = [
  'KEEP_SOURCE_PREFIX',
  'REPLACE_TEXT_ONLY',
  'NUMBERING_ENGINE',
] as const;

export type PrefixPolicy = (typeof PREFIX_POLICIES)[number];

/** §1.6 — how an outline level was established for a pattern. */
export const OUTLINE_PATTERN_KINDS = [
  'AUTO_NUMBERING',
  'OUTLINE_PROPERTY',
  'LITERAL_PREFIX',
] as const;

export type OutlinePatternKind = (typeof OUTLINE_PATTERN_KINDS)[number];

/** HWPUNIT indent measured on the paragraph shape (§1.6-4). Two values, not
 * one number: `marginIntent` is a hanging indent and is frequently negative,
 * so summing them into a scalar inverts the hierarchy. */
export interface OutlineIndent {
  marginLeft: number;
  marginIntent: number;
}

/** §1.6-5 parent→child repetition evidence. */
export interface OutlinePatternTransition {
  toPatternId: string;
  count: number;
}

export interface TemplateProfileOutlinePattern {
  patternId: string;
  kind: OutlinePatternKind;
  literalPrefix: string;
  /** VERBATIM. Trimming it collapses '□'/'○'/'※' onto one level (§1.6-3). */
  leadingWhitespace: string;
  trailingWhitespace: string;
  indent: OutlineIndent;
  paraPrIds: number[];
  outlineLevel: number;
  occurrences: number;
  firstDocumentOrder: number;
  transitions: OutlinePatternTransition[];
  /** §1.6-6 conflicting level/prefix evidence → user confirmation item. */
  confirmRequired: boolean;
  conflicts: string[];
}

export interface TemplateProfilePrototype {
  prototypeId: string;
  styleRole: string;
  outlineLevel: number | null;
  tableContext: boolean;
  clonePolicy: ClonePolicy;
  prefixPolicy: PrefixPolicy;
  /** §1.7 resolvePrototype fallback order for this role. */
  fallbackChain: string[];
  sourceParagraphId: string | null;
  sourceTableId: string | null;
  rawXmlAnchor: RawXmlAnchor;
  immutable: true;
  evidence: string;
}

export interface TemplateProfileStaticRegion {
  regionId: string;
  kind: StaticRegionKind;
  locator: RawXmlAnchor;
  evidence: string;
}

export interface TemplateProfileCompatibility {
  verdict: DocumentCompatibilityVerdict;
  confidence: number;
  components: ConfidenceComponents;
  /** Per-component "what was counted" strings — G15-1 판정 근거 재현. */
  confidenceBasis: Record<keyof ConfidenceComponents, string>;
  objectCounts: Record<HwpxObjectClass, number>;
  objects: ObjectClassification[];
  unclassifiedElements: UnclassifiedElement[];
}

export interface TemplateProfile {
  /** Bumped when the shape changes, so rows written by earlier code stay
   * interpretable (same contract as `DocumentIR.irVersion`). */
  profileVersion: '1';
  /** SHA-256 of the analyzed HWPX package bytes — ties the profile to an
   * exact input, so `analysis_status` can never be attributed to the wrong
   * upload. */
  sourceHash: string;
  compatibility: TemplateProfileCompatibility;
  outlinePatterns: TemplateProfileOutlinePattern[];
  prototypes: TemplateProfilePrototype[];
  staticRegions: TemplateProfileStaticRegion[];
  warnings: string[];
}
