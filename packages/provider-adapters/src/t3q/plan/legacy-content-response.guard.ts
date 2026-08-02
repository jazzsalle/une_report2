/**
 * Runtime shape guard for the transcribed RPT-002 ContentResponse
 * (contracts/openapi/t3q-report-adapter-v0.8.5-une1.yaml — SHA-256 pinned).
 * Same contract as guardTocResponse: validate BEFORE mapping, throw with a
 * JSON-pointer path; adapters convert the throw into a
 * T3Q_RESPONSE_CONTRACT_VIOLATION failure that keeps the raw payload.
 */

export interface LegacyReference {
  id: string;
  fileId: string;
  fileName: string;
  page: string;
}

export interface LegacyContentSection {
  name: string;
  content: string;
  references: LegacyReference[];
  children: LegacyContentSection[];
}

export interface LegacyContentResponse {
  sections: LegacyContentSection[];
}

export class LegacyContentResponseError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'LegacyContentResponseError';
  }
}

export function guardContentResponse(raw: unknown): LegacyContentResponse {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new LegacyContentResponseError('/', 'ContentResponse must be an object');
  }
  const record = raw as Record<string, unknown>;
  return { sections: guardContentSections(record.sections, '/sections') };
}

/** SSE frames stream single ContentSection objects (fixture transcript —
 * framing itself is a UNE assumption, OB-01). */
export function guardContentSection(raw: unknown, path = '/'): LegacyContentSection {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new LegacyContentResponseError(path, 'section must be an object');
  }
  const section = raw as Record<string, unknown>;
  if (typeof section.name !== 'string' || section.name.trim().length === 0) {
    throw new LegacyContentResponseError(`${path}/name`, 'name must be a non-empty string');
  }
  if (typeof section.content !== 'string') {
    throw new LegacyContentResponseError(`${path}/content`, 'content must be a string');
  }
  return {
    name: section.name,
    content: section.content,
    references: guardReferences(section.references, `${path}/references`),
    children: guardContentSections(section.children ?? [], `${path}/children`),
  };
}

function guardContentSections(value: unknown, path: string): LegacyContentSection[] {
  if (!Array.isArray(value)) {
    throw new LegacyContentResponseError(path, 'sections must be an array');
  }
  return value.map((entry, index) => guardContentSection(entry, `${path}/${index}`));
}

function guardReferences(value: unknown, path: string): LegacyReference[] {
  if (!Array.isArray(value)) {
    throw new LegacyContentResponseError(path, 'references must be an array');
  }
  return value.map((entry, index) => {
    const entryPath = `${path}/${index}`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new LegacyContentResponseError(entryPath, 'reference must be an object');
    }
    const reference = entry as Record<string, unknown>;
    for (const field of ['id', 'fileId', 'fileName', 'page'] as const) {
      if (typeof reference[field] !== 'string') {
        throw new LegacyContentResponseError(`${entryPath}/${field}`, `${field} must be a string`);
      }
    }
    return {
      id: reference.id as string,
      fileId: reference.fileId as string,
      fileName: reference.fileName as string,
      page: reference.page as string,
    };
  });
}
