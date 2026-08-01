/** generation_job.request_json payload for TOC jobs — the single seam between
 * the API (writer) and the worker (reader). Version-pinned and parsed
 * strictly so drift between the two processes fails loudly (ADR-25). The
 * snapshot content itself is NOT duplicated here: plan_context_snapshot is
 * immutable and the worker re-reads it by id, verifying contextHash. */

export const TOC_JOB_REQUEST_VERSION = '1';

export interface TocJobGenerationOption {
  additionalInstruction?: string;
  notes?: string;
}

export interface TocJobRequest {
  schemaVersion: typeof TOC_JOB_REQUEST_VERSION;
  snapshotId: string;
  /** canonical SHA-256 of the snapshot's context_json (pin against the
   * impossible-but-audited case of snapshot content divergence). */
  contextHash: string;
  /** Requesting user — the worker records toc_version.created_by and audit
   * actor from this (generation_job has no user column). */
  requestedBy: string;
  generationOption?: TocJobGenerationOption;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const MAX_OPTION_LENGTH = 2000;

export class TocJobRequestError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'TocJobRequestError';
  }
}

export function buildTocJobRequest(input: {
  snapshotId: string;
  contextHash: string;
  requestedBy: string;
  generationOption?: TocJobGenerationOption;
}): TocJobRequest {
  const request: TocJobRequest = {
    schemaVersion: TOC_JOB_REQUEST_VERSION,
    snapshotId: input.snapshotId,
    contextHash: input.contextHash,
    requestedBy: input.requestedBy,
    ...(input.generationOption ? { generationOption: input.generationOption } : {}),
  };
  assertValid(request);
  return request;
}

export function parseTocJobRequest(value: unknown): TocJobRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TocJobRequestError('/', 'request_json must be an object');
  }
  const record = value as Record<string, unknown>;
  const known = new Set([
    'schemaVersion',
    'snapshotId',
    'contextHash',
    'requestedBy',
    'generationOption',
  ]);
  for (const key of Object.keys(record)) {
    if (!known.has(key)) throw new TocJobRequestError(key, `unknown field: ${key}`);
  }
  const request = record as unknown as TocJobRequest;
  assertValid(request);
  return request;
}

function assertValid(request: TocJobRequest): void {
  if (request.schemaVersion !== TOC_JOB_REQUEST_VERSION) {
    throw new TocJobRequestError(
      'schemaVersion',
      `unsupported TocJobRequest version: ${String(request.schemaVersion)}`,
    );
  }
  if (typeof request.snapshotId !== 'string' || !UUID_PATTERN.test(request.snapshotId)) {
    throw new TocJobRequestError('snapshotId', 'snapshotId must be a UUID');
  }
  if (typeof request.contextHash !== 'string' || !HASH_PATTERN.test(request.contextHash)) {
    throw new TocJobRequestError('contextHash', 'contextHash must be 64 lowercase hex chars');
  }
  if (typeof request.requestedBy !== 'string' || !UUID_PATTERN.test(request.requestedBy)) {
    throw new TocJobRequestError('requestedBy', 'requestedBy must be a UUID');
  }
  if (request.generationOption !== undefined) {
    const option = request.generationOption;
    if (option === null || typeof option !== 'object' || Array.isArray(option)) {
      throw new TocJobRequestError('generationOption', 'generationOption must be an object');
    }
    const knownOptions = new Set(['additionalInstruction', 'notes']);
    for (const [key, val] of Object.entries(option)) {
      if (!knownOptions.has(key)) {
        throw new TocJobRequestError(`generationOption.${key}`, `unknown option: ${key}`);
      }
      if (val !== undefined && (typeof val !== 'string' || val.length > MAX_OPTION_LENGTH)) {
        throw new TocJobRequestError(
          `generationOption.${key}`,
          `${key} must be a string of at most ${MAX_OPTION_LENGTH} chars`,
        );
      }
    }
  }
}
