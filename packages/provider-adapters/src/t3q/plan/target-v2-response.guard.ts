import type {
  GenerationAcceptedV2,
  GenerationStatusV2,
  OutlineSectionV2,
} from './target-v2-toc-mapper';
import type {
  ChangeProposalV2,
  CitationV2,
  ContentBlockV2,
  ProviderCapabilitiesV2,
  ValidationIssueV2,
} from './mock-target-v2-payloads';

/**
 * Runtime shape guards for target-v2 responses (CC-125 job shells; CC-135
 * ContentBlock/Citation/ChangeProposal/Validation/Capabilities). Responses
 * are validated BEFORE mapping even though today they only come from the
 * UNE in-process mock — the guard IS the contract seam that stays when a
 * real transport appears (CC-400).
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
  if (record.blocks !== undefined) {
    guardContentBlocks(record.blocks, '/blocks');
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

const BLOCK_TYPES = new Set(['PARAGRAPH', 'BULLET', 'TABLE', 'NOTE', 'CAPTION', 'PLACEHOLDER']);
const BLOCK_STATUSES = new Set(['GENERATED', 'PARTIAL', 'FAILED', 'PRESERVED', 'PROTECTED']);
const ISSUE_SEVERITIES = new Set(['INFO', 'WARNING', 'ERROR']);
const OPERATION_TYPES = new Set(['REPLACE_RANGE', 'REPLACE_BLOCK', 'INSERT_BLOCK', 'DELETE_BLOCK']);

export function guardCitation(value: unknown, path: string): CitationV2 {
  const record = asObject(value, path);
  for (const field of [
    'citationId',
    'sourceId',
    'documentId',
    'fileName',
    'retrievedAt',
  ] as const) {
    requireString(record, field, path);
  }
  if (typeof record.excerpt !== 'string') {
    throw new TargetV2ResponseError(`${path}/excerpt`, 'excerpt must be a string');
  }
  if (typeof record.score !== 'number' || record.score < 0 || record.score > 1) {
    throw new TargetV2ResponseError(`${path}/score`, 'score must be a number in [0,1]');
  }
  if (record.page !== undefined && record.page !== null) {
    if (typeof record.page !== 'number' || !Number.isInteger(record.page) || record.page < 1) {
      throw new TargetV2ResponseError(`${path}/page`, 'page must be an integer >= 1 or null');
    }
  }
  if (
    record.chunkId !== undefined &&
    record.chunkId !== null &&
    typeof record.chunkId !== 'string'
  ) {
    throw new TargetV2ResponseError(`${path}/chunkId`, 'chunkId must be a string or null');
  }
  if (record.supportsBlockIds !== undefined) {
    requireStringArray(record, 'supportsBlockIds', path);
  }
  return record as unknown as CitationV2;
}

export function guardContentBlock(value: unknown, path: string): ContentBlockV2 {
  const record = asObject(value, path);
  requireString(record, 'blockId', path);
  requireString(record, 'sectionId', path);
  if (typeof record.blockType !== 'string' || !BLOCK_TYPES.has(record.blockType)) {
    throw new TargetV2ResponseError(
      `${path}/blockType`,
      `invalid blockType: ${String(record.blockType)}`,
    );
  }
  if (typeof record.order !== 'number' || !Number.isInteger(record.order) || record.order < 0) {
    throw new TargetV2ResponseError(`${path}/order`, 'order must be an integer >= 0');
  }
  if (typeof record.text !== 'string') {
    throw new TargetV2ResponseError(`${path}/text`, 'text must be a string');
  }
  if (!Array.isArray(record.citations)) {
    throw new TargetV2ResponseError(`${path}/citations`, 'citations must be an array');
  }
  record.citations.forEach((citation, index) =>
    guardCitation(citation, `${path}/citations/${index}`),
  );
  requireStringArray(record, 'warnings', path);
  if (typeof record.status !== 'string' || !BLOCK_STATUSES.has(record.status)) {
    throw new TargetV2ResponseError(`${path}/status`, `invalid status: ${String(record.status)}`);
  }
  return record as unknown as ContentBlockV2;
}

export function guardContentBlocks(value: unknown, path: string): ContentBlockV2[] {
  if (!Array.isArray(value)) throw new TargetV2ResponseError(path, 'blocks must be an array');
  return value.map((entry, index) => guardContentBlock(entry, `${path}/${index}`));
}

export function guardChangeProposal(raw: unknown): ChangeProposalV2 {
  const record = asObject(raw, '/');
  requireString(record, 'proposalId', '/');
  requireString(record, 'baseRevisionId', '/');
  if (!Array.isArray(record.operations)) {
    throw new TargetV2ResponseError('/operations', 'operations must be an array');
  }
  record.operations.forEach((entry, index) => {
    const path = `/operations/${index}`;
    const operation = asObject(entry, path);
    if (
      typeof operation.operationType !== 'string' ||
      !OPERATION_TYPES.has(operation.operationType)
    ) {
      throw new TargetV2ResponseError(
        `${path}/operationType`,
        `invalid operationType: ${String(operation.operationType)}`,
      );
    }
    if (
      operation.targetId !== undefined &&
      operation.targetId !== null &&
      typeof operation.targetId !== 'string'
    ) {
      throw new TargetV2ResponseError(`${path}/targetId`, 'targetId must be a string or null');
    }
  });
  guardContentBlocks(record.proposedBlocks, '/proposedBlocks');
  if (!Array.isArray(record.citations)) {
    throw new TargetV2ResponseError('/citations', 'citations must be an array');
  }
  record.citations.forEach((citation, index) => guardCitation(citation, `/citations/${index}`));
  requireStringArray(record, 'warnings', '/');
  return record as unknown as ChangeProposalV2;
}

export function guardEvidenceSearchResponse(raw: unknown): {
  requestId: string;
  items: CitationV2[];
} {
  const record = asObject(raw, '/');
  requireString(record, 'requestId', '/');
  if (!Array.isArray(record.items)) {
    throw new TargetV2ResponseError('/items', 'items must be an array');
  }
  const items = record.items.map((entry, index) => guardCitation(entry, `/items/${index}`));
  return { requestId: record.requestId as string, items };
}

export function guardValidationReport(raw: unknown): {
  valid: boolean;
  issues: ValidationIssueV2[];
} {
  const record = asObject(raw, '/');
  if (typeof record.valid !== 'boolean') {
    throw new TargetV2ResponseError('/valid', 'valid must be a boolean');
  }
  if (!Array.isArray(record.issues)) {
    throw new TargetV2ResponseError('/issues', 'issues must be an array');
  }
  const issues = record.issues.map((entry, index) => {
    const path = `/issues/${index}`;
    const issue = asObject(entry, path);
    requireString(issue, 'issueId', path);
    requireString(issue, 'type', path);
    if (typeof issue.severity !== 'string' || !ISSUE_SEVERITIES.has(issue.severity)) {
      throw new TargetV2ResponseError(
        `${path}/severity`,
        `invalid severity: ${String(issue.severity)}`,
      );
    }
    requireString(issue, 'message', path);
    for (const field of ['sectionId', 'blockId', 'citationId'] as const) {
      if (issue[field] !== undefined && issue[field] !== null && typeof issue[field] !== 'string') {
        throw new TargetV2ResponseError(`${path}/${field}`, `${field} must be a string or null`);
      }
    }
    return issue as unknown as ValidationIssueV2;
  });
  return { valid: record.valid as boolean, issues };
}

export function guardProviderCapabilities(raw: unknown): ProviderCapabilitiesV2 {
  const record = asObject(raw, '/');
  requireString(record, 'providerBuild', '/');
  requireStringArray(record, 'contractVersions', '/');
  const features = asObject(record.features, '/features');
  for (const key of [
    'tocV2',
    'contentV2',
    'semanticEdit',
    'evidenceSearch',
    'validation',
    'jobSse',
    'partialRetry',
  ]) {
    if (typeof features[key] !== 'boolean') {
      throw new TargetV2ResponseError(`/features/${key}`, `${key} must be a boolean`);
    }
  }
  asObject(record.limits, '/limits');
  return record as unknown as ProviderCapabilitiesV2;
}

function requireStringArray(record: Record<string, unknown>, field: string, path: string): void {
  const value = record[field];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new TargetV2ResponseError(`${path}/${field}`, `${field} must be a string array`);
  }
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
