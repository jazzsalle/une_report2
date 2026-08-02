import { describe, expect, it } from 'vitest';
import {
  AUTO_CONFIDENCE_THRESHOLD,
  CONFIDENCE_WEIGHTS,
  CONFIRM_CONFIDENCE_THRESHOLD,
  computeConfidence,
  rollUpVerdict,
  type ConfidenceComponents,
  type HwpxFinding,
  type ObjectClassification,
} from './compatibility';

const flat = (value: number): ConfidenceComponents => ({
  styleConsistency: value,
  prefixConsistency: value,
  indentHierarchy: value,
  repetitionEvidence: value,
  positionEvidence: value,
  semanticHint: value,
});

const object = (
  objectClass: ObjectClassification['objectClass'],
  scope: ObjectClassification['scope'] = 'ELEMENT',
  capsVerdict = true,
): ObjectClassification => ({
  objectClass,
  scope,
  reasonCode: 'TEST',
  locator: 'Contents/section0.xml#p[1]',
  evidence: 'test fixture',
  capsVerdict,
});

const finding = (severity: HwpxFinding['severity']): HwpxFinding => ({
  code: 'HWPX-1003',
  severity,
  locator: 'Contents/header.xml',
  detail: 'test fixture',
});

describe('confidence (Spec §1.5 weighted sum)', () => {
  it('weights sum to 1.0 — a flat input returns that value unchanged', () => {
    const sum = Object.values(CONFIDENCE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(computeConfidence(flat(1))).toBe(1);
    expect(computeConfidence(flat(0))).toBe(0);
    expect(computeConfidence(flat(0.5))).toBe(0.5);
  });

  it('applies the baseline weights per component, not an average', () => {
    // Only styleConsistency perfect → exactly its weight (0.30).
    expect(computeConfidence({ ...flat(0), styleConsistency: 1 })).toBe(0.3);
    expect(computeConfidence({ ...flat(0), semanticHint: 1 })).toBe(0.1);
  });

  it('rejects out-of-range components instead of clamping them', () => {
    expect(() => computeConfidence({ ...flat(0), styleConsistency: 1.2 })).toThrow(RangeError);
    expect(() => computeConfidence({ ...flat(0), semanticHint: -0.1 })).toThrow(RangeError);
    expect(() => computeConfidence({ ...flat(0), indentHierarchy: Number.NaN })).toThrow(
      RangeError,
    );
  });
});

describe('rollUpVerdict (ADR-29 D2 rules 1~4)', () => {
  it('rule 1: any REJECT object rejects the document, even at perfect confidence', () => {
    expect(
      rollUpVerdict({
        objects: [object('NATIVE_EDIT'), object('REJECT')],
        findings: [],
        confidence: 1,
      }),
    ).toBe('REJECT');
  });

  it('rule 2: a FATAL finding rejects the document', () => {
    expect(rollUpVerdict({ objects: [], findings: [finding('FATAL')], confidence: 1 })).toBe(
      'REJECT',
    );
    // Non-fatal findings do not.
    expect(rollUpVerdict({ objects: [], findings: [finding('DEGRADING')], confidence: 1 })).toBe(
      'AUTO',
    );
  });

  it('rule 3: ELEMENT-scope PRESERVE_ONLY / FLATTEN_EXPORT_ONLY cap the verdict at LIMITED (HWPX-1004)', () => {
    for (const kind of ['PRESERVE_ONLY', 'FLATTEN_EXPORT_ONLY'] as const) {
      expect(
        rollUpVerdict({ objects: [object(kind, 'ELEMENT')], findings: [], confidence: 1 }),
      ).toBe('LIMITED');
    }
  });

  it('rule 3 does NOT cap on PART scope — otherwise AUTO is unreachable for every real HWPX', () => {
    // Measured on the real corpus (ADR-29 D2 amendment): every HWPX carries
    // PRESERVE_ONLY package parts (Preview/*, META-INF/container.rdf,
    // Scripts/*). Capping on those would make the AUTO band dead by
    // construction and G15-1's "reproduce the AUTO verdict" unsatisfiable.
    for (const kind of ['PRESERVE_ONLY', 'FLATTEN_EXPORT_ONLY'] as const) {
      expect(
        rollUpVerdict({ objects: [object(kind, 'PART')], findings: [], confidence: 0.9 }),
      ).toBe('AUTO');
    }
    // A PART-scope REJECT is still fatal (rule 1 is scope-independent).
    expect(
      rollUpVerdict({ objects: [object('REJECT', 'PART')], findings: [], confidence: 1 }),
    ).toBe('REJECT');
  });

  it('rule 3 does NOT cap when capsVerdict is false — the grade axis and the cap axis are separate', () => {
    // CC-140 review M-3. Section layout properties (hp:colPr …) and whitespace
    // constructs (hp:fwSpace …) are honestly PRESERVE_ONLY — the IR does not
    // parse them — but §8.4 marks them normal for the user, so they must not
    // drag every real document to LIMITED. Grading them NATIVE_EDIT to dodge
    // the cap would tell CC-160 to "minimally re-save" XML nobody parsed.
    for (const kind of ['PRESERVE_ONLY', 'FLATTEN_EXPORT_ONLY'] as const) {
      expect(
        rollUpVerdict({ objects: [object(kind, 'ELEMENT', false)], findings: [], confidence: 0.9 }),
      ).toBe('AUTO');
    }
    // One capping object among non-capping ones still caps.
    expect(
      rollUpVerdict({
        objects: [object('PRESERVE_ONLY', 'ELEMENT', false), object('PRESERVE_ONLY', 'ELEMENT')],
        findings: [],
        confidence: 1,
      }),
    ).toBe('LIMITED');
    // capsVerdict never rescues a REJECT (rule 1 runs first).
    expect(
      rollUpVerdict({ objects: [object('REJECT', 'ELEMENT', false)], findings: [], confidence: 1 }),
    ).toBe('REJECT');
  });

  it('rule 4: confidence bands apply only when nothing caps the verdict', () => {
    const clean = { objects: [object('NATIVE_EDIT')], findings: [] };
    expect(rollUpVerdict({ ...clean, confidence: AUTO_CONFIDENCE_THRESHOLD })).toBe('AUTO');
    expect(rollUpVerdict({ ...clean, confidence: AUTO_CONFIDENCE_THRESHOLD - 0.0001 })).toBe(
      'CONFIRM',
    );
    expect(rollUpVerdict({ ...clean, confidence: CONFIRM_CONFIDENCE_THRESHOLD })).toBe('CONFIRM');
    expect(rollUpVerdict({ ...clean, confidence: CONFIRM_CONFIDENCE_THRESHOLD - 0.0001 })).toBe(
      'LIMITED',
    );
  });

  it('an empty document with high confidence is AUTO (no objects, no findings)', () => {
    expect(rollUpVerdict({ objects: [], findings: [], confidence: 0.9 })).toBe('AUTO');
  });
});
