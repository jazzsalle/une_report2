/**
 * Runtime shape guard for the transcribed RPT-001 TocResponse
 * (contracts/openapi/t3q-report-adapter-v0.8.5-une1.yaml — SHA-256 pinned).
 * Provider responses are validated BEFORE mapping to domain objects
 * (.claude/rules/provider-adapters.md); violations become job failures with
 * the raw payload preserved, never partial trees.
 */

export interface LegacyTocSection {
  name: string;
  children: LegacyTocSection[];
}

export interface LegacyTocResponse {
  title: string;
  sections: LegacyTocSection[];
}

export class LegacyTocResponseError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'LegacyTocResponseError';
  }
}

export function guardTocResponse(raw: unknown): LegacyTocResponse {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new LegacyTocResponseError('/', 'TocResponse must be an object');
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.title !== 'string') {
    throw new LegacyTocResponseError('/title', 'title must be a string');
  }
  return { title: record.title, sections: guardSections(record.sections, '/sections') };
}

function guardSections(value: unknown, path: string): LegacyTocSection[] {
  if (!Array.isArray(value)) {
    throw new LegacyTocResponseError(path, 'sections must be an array');
  }
  return value.map((entry, index) => {
    const entryPath = `${path}/${index}`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new LegacyTocResponseError(entryPath, 'section must be an object');
    }
    const section = entry as Record<string, unknown>;
    if (typeof section.name !== 'string' || section.name.trim().length === 0) {
      throw new LegacyTocResponseError(`${entryPath}/name`, 'name must be a non-empty string');
    }
    return {
      name: section.name,
      children: guardSections(section.children ?? [], `${entryPath}/children`),
    };
  });
}
