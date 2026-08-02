import type {
  GenerationAcceptedV2,
  GenerationStatusV2,
  OutlineSectionV2,
} from './target-v2-toc-mapper';

/**
 * Runtime shape guards for target-v2 GenerationAccepted / GenerationStatus
 * (CC-125). Responses are validated BEFORE mapping even though today they
 * only come from the UNE in-process mock — the guard IS the contract seam
 * that stays when a real transport appears (CC-400).
 */

const GENERATION_STATUSES = new Set([
  'QUEUED',
  'RUNNING',
  'PARTIAL',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
]);

const GENERATION_POLICIES = new Set(['GENERATE', 'PRESERVE', 'USER_ONLY', 'REFERENCE_ONLY']);

export class TargetV2ResponseError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'TargetV2ResponseError';
  }
}

export function guardGenerationAccepted(raw: unknown): GenerationAcceptedV2 {
  const record = asObject(raw, '/');
  requireString(record, 'generationId', '/');
  if (record.status !== 'QUEUED') {
    throw new TargetV2ResponseError('/status', 'GenerationAccepted.status must be QUEUED');
  }
  requireString(record, 'statusUrl', '/');
  requireString(record, 'eventStreamUrl', '/');
  requireString(record, 'acceptedAt', '/');
  return record as unknown as GenerationAcceptedV2;
}

export function guardGenerationStatus(raw: unknown): GenerationStatusV2 {
  const record = asObject(raw, '/');
  requireString(record, 'generationId', '/');
  if (typeof record.status !== 'string' || !GENERATION_STATUSES.has(record.status)) {
    throw new TargetV2ResponseError('/status', `invalid status: ${String(record.status)}`);
  }
  if (typeof record.progress !== 'number' || record.progress < 0 || record.progress > 100) {
    throw new TargetV2ResponseError('/progress', 'progress must be a number in [0,100]');
  }
  for (const field of ['completedTargetIds', 'failedTargetIds'] as const) {
    const value = record[field];
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
      throw new TargetV2ResponseError(`/${field}`, `${field} must be a string array`);
    }
  }
  if (record.outline !== undefined) {
    guardOutlineSections(record.outline, '/outline');
  }
  return record as unknown as GenerationStatusV2;
}

export function guardOutlineSections(value: unknown, path: string): OutlineSectionV2[] {
  if (!Array.isArray(value)) {
    throw new TargetV2ResponseError(path, 'outline must be an array');
  }
  return value.map((entry, index) => {
    const entryPath = `${path}/${index}`;
    const section = asObject(entry, entryPath);
    requireString(section, 'sectionId', entryPath);
    requireString(section, 'title', entryPath);
    requireString(section, 'semanticRole', entryPath);
    if (
      section.parentSectionId !== undefined &&
      section.parentSectionId !== null &&
      typeof section.parentSectionId !== 'string'
    ) {
      throw new TargetV2ResponseError(
        `${entryPath}/parentSectionId`,
        'parentSectionId must be a string or null',
      );
    }
    for (const field of ['outlineLevel', 'order'] as const) {
      if (typeof section[field] !== 'number') {
        throw new TargetV2ResponseError(`${entryPath}/${field}`, `${field} must be a number`);
      }
    }
    if (
      typeof section.generationPolicy !== 'string' ||
      !GENERATION_POLICIES.has(section.generationPolicy)
    ) {
      throw new TargetV2ResponseError(
        `${entryPath}/generationPolicy`,
        `invalid generationPolicy: ${String(section.generationPolicy)}`,
      );
    }
    if (typeof section.required !== 'boolean') {
      throw new TargetV2ResponseError(`${entryPath}/required`, 'required must be a boolean');
    }
    return section as unknown as OutlineSectionV2;
  });
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TargetV2ResponseError(path, 'must be an object');
  }
  return value as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, field: string, path: string): void {
  if (typeof record[field] !== 'string' || record[field].length === 0) {
    throw new TargetV2ResponseError(
      `${path}${path.endsWith('/') ? '' : '/'}${field}`,
      `${field} must be a non-empty string`,
    );
  }
}
