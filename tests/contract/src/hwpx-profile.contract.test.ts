import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import {
  CLONE_POLICIES,
  OUTLINE_PATTERN_KINDS,
  PREFIX_POLICIES,
  STATIC_REGION_KINDS,
} from '@une/domain';
import { HwpxEngine, loadCorpus, readCorpusFile } from '@une/hwpx-engine';
import { REPO_ROOT, loadJson } from './contract-loader';

/**
 * Template Profile / Document IR contract validated against REAL ENGINE OUTPUT
 * (CC-140, ADR-29 D5; Spec §1.14 "Schema Bundle의 Document IR/Template/
 * Prototype 예제가 CI에서 검증된다").
 *
 * The sibling document-ir test validates a HAND-WRITTEN instance, which cannot
 * catch the case the review actually found: a schema that no real analyzer
 * output can satisfy. This file closes that hole by feeding every corpus
 * document through the engine and validating what it really produces.
 */

const irSchema = loadJson('contracts', 'schemas', 'document-ir.schema.json');
const profileSchema = loadJson('contracts', 'schemas', 'template-profile.schema.json');

function compile(schema: Record<string, unknown>): ValidateFunction {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

const validateIr = compile(irSchema);
const validateProfile = compile(profileSchema);

const engine = new HwpxEngine();
const corpus = loadCorpus(REPO_ROOT);

function errorsOf(validate: ValidateFunction): string {
  return (validate.errors ?? [])
    .slice(0, 8)
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
}

describe('real engine output ↔ contracts/schemas', () => {
  it('the corpus is non-empty — a vacuous pass would prove nothing', () => {
    expect(corpus.files.length).toBeGreaterThanOrEqual(6);
  });

  for (const file of corpus.files) {
    describe(file.alias, () => {
      const result = engine.analyzeDocument({
        bytes: readCorpusFile(file),
        fileName: file.alias,
      });

      it('DocumentIR validates against document-ir.schema.json', () => {
        const valid = validateIr(result.ir);
        expect(valid, errorsOf(validateIr)).toBe(true);
      });

      it('TemplateProfile validates against template-profile.schema.json', () => {
        const valid = validateProfile(result.profile);
        expect(valid, errorsOf(validateProfile)).toBe(true);
      });

      it('the profile carries the analysis verdict the manifest pinned', () => {
        expect(result.profile.compatibility.verdict).toBe(file.expectedVerdict);
        expect(result.profile.compatibility.confidence).toBe(file.measuredConfidence);
        expect(result.profile.sourceHash).toBe(result.ir.sourceHash);
      });

      it('every classification carries reproducible evidence (G15-1)', () => {
        for (const object of result.profile.compatibility.objects) {
          expect(object.reasonCode.length).toBeGreaterThan(0);
          expect(object.locator.length).toBeGreaterThan(0);
          expect(object.evidence.length).toBeGreaterThan(0);
        }
      });
    });
  }
});

describe('closed vocabularies stay identical in schema and code', () => {
  const enumAt = (schema: Record<string, unknown>, path: string[]): string[] => {
    let node: unknown = schema;
    for (const key of path) node = (node as Record<string, unknown>)?.[key];
    const values = (node as { enum?: string[] } | undefined)?.enum;
    if (!values) throw new Error(`no enum at ${path.join('/')}`);
    return [...values].sort();
  };

  it('staticRegion.kind matches the domain union (8 kinds, not the 6 the draft had)', () => {
    expect(enumAt(profileSchema, ['$defs', 'staticRegion', 'properties', 'kind'])).toEqual(
      [...STATIC_REGION_KINDS].sort(),
    );
  });

  it('clonePolicy and prefixPolicy match the domain unions', () => {
    expect(enumAt(profileSchema, ['$defs', 'prototype', 'properties', 'clonePolicy'])).toEqual(
      [...CLONE_POLICIES].sort(),
    );
    expect(enumAt(profileSchema, ['$defs', 'prototype', 'properties', 'prefixPolicy'])).toEqual(
      [...PREFIX_POLICIES].sort(),
    );
  });

  it('outlinePattern.kind matches the domain union', () => {
    expect(enumAt(profileSchema, ['$defs', 'outlinePattern', 'properties', 'kind'])).toEqual(
      [...OUTLINE_PATTERN_KINDS].sort(),
    );
  });
});

describe('schema negatives — additionalProperties is effective on real output', () => {
  const sample = engine.analyzeDocument({
    bytes: readFileSync(corpus.files[0].path),
    fileName: corpus.files[0].alias,
  });

  it('rejects a typo field on the profile', () => {
    expect(validateProfile({ ...sample.profile, sourceHsah: 'x' })).toBe(false);
  });

  it('rejects an outline pattern whose whitespace fields were dropped', () => {
    if (sample.profile.outlinePatterns.length === 0) return;
    const mutated = structuredClone(sample.profile) as unknown as {
      outlinePatterns: Record<string, unknown>[];
    };
    delete mutated.outlinePatterns[0].leadingWhitespace;
    expect(validateProfile(mutated)).toBe(false);
  });

  it('rejects a classification without capsVerdict — the cap axis must be explicit', () => {
    const mutated = structuredClone(sample.profile) as unknown as {
      compatibility: { objects: Record<string, unknown>[] };
    };
    if (mutated.compatibility.objects.length === 0) return;
    delete mutated.compatibility.objects[0].capsVerdict;
    expect(validateProfile(mutated)).toBe(false);
  });
});
