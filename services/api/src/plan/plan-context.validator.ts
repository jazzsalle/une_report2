// plan-context.schema.json declares draft 2020-12; the default Ajv export
// only preloads the draft-07 meta-schema.
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { ErrorViolation } from '../common/api-error';
import { planContextSchema } from '../generated/plan-context.schema';

/** Validation vocabulary comes from the schema itself (single source of
 * truth); the create/patch endpoints reuse the same enums for plan columns
 * (ADR-23 D3). */
const schema = planContextSchema as unknown as Record<string, unknown>;
const properties = schema.properties as Record<string, Record<string, unknown>>;
const backgroundInfo = properties.backgroundInfo.properties as Record<
  string,
  Record<string, unknown>
>;

export const HAZARD_TYPES: readonly string[] = backgroundInfo.disasterType.enum as string[];
export const MANAGEMENT_PHASES: readonly string[] = backgroundInfo.controlPhase.enum as string[];

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateFn: ValidateFunction = ajv.compile(schema);

function toViolation(error: ErrorObject): ErrorViolation {
  const field =
    error.keyword === 'required'
      ? `${error.instancePath}/${(error.params as { missingProperty: string }).missingProperty}`
      : error.instancePath || '/';
  return { field, reason: error.message ?? error.keyword };
}

// A draft may be incomplete: missing fields and still-empty values are part
// of normal editing. Wrong types/enums/max-lengths are real defects even
// mid-edit (ADR-23 D2 / US-PLAN-007 AC-01).
const DRAFT_TOLERATED_KEYWORDS = new Set(['required', 'minLength', 'minItems']);

/**
 * draft: incompleteness (required/minLength/minItems) is tolerated but
 * type/enum/maxLength/additionalProperties violations are not.
 * strict: the full schema must pass before a snapshot is confirmed.
 */
export function validatePlanContext(value: unknown, mode: 'draft' | 'strict'): ErrorViolation[] {
  const valid = validateFn(value);
  if (valid) return [];
  const errors = validateFn.errors ?? [];
  const relevant =
    mode === 'draft' ? errors.filter((e) => !DRAFT_TOLERATED_KEYWORDS.has(e.keyword)) : errors;
  return relevant.map(toViolation);
}
