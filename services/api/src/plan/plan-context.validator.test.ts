import { describe, expect, it } from 'vitest';
import { HAZARD_TYPES, MANAGEMENT_PHASES, validatePlanContext } from './plan-context.validator';

const fullContext = {
  subject: '지진 대비 계획',
  backgroundInfo: { disasterType: '지진', controlPhase: '대비' },
  purposeOfDocument: {
    goalOfBusiness: '피해 최소화',
    role: '작성자',
    targetAudiences: ['중앙정부'],
  },
};

describe('validatePlanContext', () => {
  it('exposes the schema vocabularies (single source of truth)', () => {
    expect(HAZARD_TYPES).toHaveLength(10);
    expect(HAZARD_TYPES).toContain('폭염');
    expect(MANAGEMENT_PHASES).toEqual(['예방', '대비']);
  });

  it('accepts a fully valid context in both modes', () => {
    expect(validatePlanContext(fullContext, 'strict')).toEqual([]);
    expect(validatePlanContext(fullContext, 'draft')).toEqual([]);
  });

  it('draft mode tolerates missing required fields but strict mode does not', () => {
    const partial = { subject: '작성 중' };
    expect(validatePlanContext(partial, 'draft')).toEqual([]);
    const strict = validatePlanContext(partial, 'strict');
    expect(strict.length).toBeGreaterThan(0);
    expect(strict.map((v) => v.field)).toEqual(
      expect.arrayContaining(['/backgroundInfo', '/purposeOfDocument']),
    );
  });

  it('draft mode tolerates still-empty values (minLength/minItems) mid-edit', () => {
    const inProgress = {
      subject: '',
      purposeOfDocument: { goalOfBusiness: '', role: '', targetAudiences: [] },
    };
    expect(validatePlanContext(inProgress, 'draft')).toEqual([]);
    expect(validatePlanContext(inProgress, 'strict').length).toBeGreaterThan(0);
  });

  it('draft mode still rejects enum/type/additionalProperties violations', () => {
    const badEnum = { backgroundInfo: { disasterType: '눈사태', controlPhase: '대비' } };
    expect(validatePlanContext(badEnum, 'draft').length).toBeGreaterThan(0);

    const badType = { subject: 123 };
    expect(validatePlanContext(badType, 'draft').length).toBeGreaterThan(0);

    const extra = { unknownField: true };
    expect(validatePlanContext(extra, 'draft').length).toBeGreaterThan(0);
  });

  it('reports violations with instance paths for screen anchoring (ALT-05)', () => {
    const bad = { ...fullContext, backgroundInfo: { disasterType: '지진', controlPhase: '복구' } };
    const violations = validatePlanContext(bad, 'strict');
    expect(violations.some((v) => v.field === '/backgroundInfo/controlPhase')).toBe(true);
  });
});
