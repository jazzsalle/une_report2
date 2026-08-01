import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

/** Repo root, resolved from this file (tests/contract/src → up 3). */
export const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');

export function repoPath(...segments: string[]): string {
  return resolve(REPO_ROOT, ...segments);
}

export function readRepoFile(...segments: string[]): string {
  return readFileSync(repoPath(...segments), 'utf8');
}

export function loadYaml(...segments: string[]): Record<string, unknown> {
  return parse(readRepoFile(...segments)) as Record<string, unknown>;
}

export function loadJson(...segments: string[]): Record<string, unknown> {
  return JSON.parse(readRepoFile(...segments)) as Record<string, unknown>;
}

/**
 * Rewrites local component refs so a single schema can be compiled standalone:
 * only $ref STRING VALUES are rewritten (`#/components/schemas/X` → `#/$defs/X`)
 * — never a document-wide string replace, which would corrupt descriptions.
 * Same algorithm as scripts/validate-contracts.mjs section 4 (kept in two
 * languages intentionally: the script is the gate, this is the test harness).
 */
function rewriteRefs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rewriteRefs);
  if (node !== null && typeof node === 'object') {
    const source = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      if (key === '$ref' && typeof value === 'string') {
        out[key] = value.replace(/^#\/components\/schemas\//, '#/$defs/');
      } else {
        out[key] = rewriteRefs(value);
      }
    }
    return out;
  }
  return node;
}

export interface CompiledContract {
  /** Compile one named schema from the document's components.schemas. */
  compile(schemaName: string): ValidateFunction;
}

/** Loads an OpenAPI document and returns a validator factory over its
 * components.schemas (Ajv 2020-12; OpenAPI 3.1 schemas are 2020-12). */
export function contractValidators(...yamlSegments: string[]): CompiledContract {
  const doc = loadYaml(...yamlSegments);
  const components = (doc.components ?? {}) as Record<string, unknown>;
  const schemas = (components.schemas ?? {}) as Record<string, unknown>;
  const defs = rewriteRefs(schemas) as Record<string, unknown>;
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const cache = new Map<string, ValidateFunction>();
  return {
    compile(schemaName: string): ValidateFunction {
      const cached = cache.get(schemaName);
      if (cached) return cached;
      const target = defs[schemaName];
      if (!target) throw new Error(`schema not found in contract: ${schemaName}`);
      const compiled = ajv.compile({
        $defs: defs,
        ...(target as Record<string, unknown>),
      });
      cache.set(schemaName, compiled);
      return compiled;
    },
  };
}

/** Formats ajv errors for assertion messages. */
export function ajvErrors(validate: ValidateFunction): string {
  return (validate.errors ?? [])
    .map((e) => `${e.instancePath || '/'} ${e.message ?? e.keyword}`)
    .join('; ');
}
