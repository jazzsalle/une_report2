import { createHash } from 'node:crypto';

/**
 * Deterministic JSON serialization: object keys sorted recursively so that
 * semantically identical payloads always hash the same. Arrays keep order
 * (order is meaningful in PlanContext lists). undefined object members are
 * dropped, matching JSON.stringify semantics.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/** SHA-256 hex of the canonical serialization (64 chars, matches char(64) DB columns). */
export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] !== undefined) sorted[key] = sortKeys(source[key]);
    }
    return sorted;
  }
  return value;
}
