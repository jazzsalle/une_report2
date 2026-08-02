/** generation_job.request_json payload for CONTENT jobs (CC-130, ADR-27) —
 * the API↔worker seam, version-pinned and strictly parsed like
 * TocJobRequest. The manifest is IMMUTABLE across retries (ADR-25 D9):
 * range narrowing is a NEW job (targetNodeKeys), never an in-place edit. */

export const CONTENT_JOB_REQUEST_VERSION = '1';

export interface ContentJobRequest {
  schemaVersion: typeof CONTENT_JOB_REQUEST_VERSION;
  snapshotId: string;
  /** canonical SHA-256 of the snapshot's context_json (immutability pin). */
  contextHash: string;
  /** Confirmed outline the generation runs against. */
  tocVersionId: string;
  /** content_hash of that toc_version — detects outline drift between
   * enqueue and execution (worker fails closed on mismatch). */
  tocContentHash: string;
  requestedBy: string;
  /** Scoped regeneration (US-PLAN-014 A-01): only these subtrees are
   * regenerated; absent = full outline. */
  targetNodeKeys?: string[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const NODE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const MAX_TARGET_NODE_KEYS = 100;

export class ContentJobRequestError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'ContentJobRequestError';
  }
}

export function buildContentJobRequest(input: {
  snapshotId: string;
  contextHash: string;
  tocVersionId: string;
  tocContentHash: string;
  requestedBy: string;
  targetNodeKeys?: string[];
}): ContentJobRequest {
  const request: ContentJobRequest = {
    schemaVersion: CONTENT_JOB_REQUEST_VERSION,
    snapshotId: input.snapshotId,
    contextHash: input.contextHash,
    tocVersionId: input.tocVersionId,
    tocContentHash: input.tocContentHash,
    requestedBy: input.requestedBy,
    ...(input.targetNodeKeys && input.targetNodeKeys.length > 0
      ? { targetNodeKeys: input.targetNodeKeys }
      : {}),
  };
  assertValid(request);
  return request;
}

export function parseContentJobRequest(value: unknown): ContentJobRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContentJobRequestError('/', 'request_json must be an object');
  }
  const record = value as Record<string, unknown>;
  const known = new Set([
    'schemaVersion',
    'snapshotId',
    'contextHash',
    'tocVersionId',
    'tocContentHash',
    'requestedBy',
    'targetNodeKeys',
  ]);
  for (const key of Object.keys(record)) {
    if (!known.has(key)) throw new ContentJobRequestError(key, `unknown field: ${key}`);
  }
  const request = record as unknown as ContentJobRequest;
  assertValid(request);
  return request;
}

function assertValid(request: ContentJobRequest): void {
  if (request.schemaVersion !== CONTENT_JOB_REQUEST_VERSION) {
    throw new ContentJobRequestError(
      'schemaVersion',
      `unsupported ContentJobRequest version: ${String(request.schemaVersion)}`,
    );
  }
  for (const field of ['snapshotId', 'tocVersionId', 'requestedBy'] as const) {
    if (typeof request[field] !== 'string' || !UUID_PATTERN.test(request[field])) {
      throw new ContentJobRequestError(field, `${field} must be a UUID`);
    }
  }
  for (const field of ['contextHash', 'tocContentHash'] as const) {
    if (typeof request[field] !== 'string' || !HASH_PATTERN.test(request[field])) {
      throw new ContentJobRequestError(field, `${field} must be 64 lowercase hex chars`);
    }
  }
  if (request.targetNodeKeys !== undefined) {
    if (!Array.isArray(request.targetNodeKeys) || request.targetNodeKeys.length === 0) {
      throw new ContentJobRequestError('targetNodeKeys', 'must be a non-empty array when present');
    }
    if (request.targetNodeKeys.length > MAX_TARGET_NODE_KEYS) {
      throw new ContentJobRequestError(
        'targetNodeKeys',
        `at most ${MAX_TARGET_NODE_KEYS} node keys`,
      );
    }
    const seen = new Set<string>();
    for (const [index, key] of request.targetNodeKeys.entries()) {
      if (typeof key !== 'string' || !NODE_KEY_PATTERN.test(key)) {
        throw new ContentJobRequestError(`targetNodeKeys/${index}`, 'invalid node key');
      }
      if (seen.has(key)) {
        throw new ContentJobRequestError(`targetNodeKeys/${index}`, `duplicate node key: ${key}`);
      }
      seen.add(key);
    }
  }
}
