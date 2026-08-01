import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { T3Q_PLAN_FEATURE_CAPABILITIES } from '@une/provider-adapters';
import { loadYaml, readRepoFile, repoPath } from './contract-loader';

/**
 * CC-115 AC "feature capability states" — governance guards (ADR-24,
 * design 13 §11, .claude/rules/provider-adapters.md): mock support must
 * never be reported as actual T3Q support, and promotions are gated on
 * OPEN_BINDINGS closure + evidence documents.
 */

const openBindings = readRepoFile('docs', 'handoff', 'OPEN_BINDINGS.md');

/** Ids listed in the OPEN table (before the Closed section). */
function openBindingIds(): Set<string> {
  const closedAt = openBindings.indexOf('## Closed');
  const openSection = closedAt === -1 ? openBindings : openBindings.slice(0, closedAt);
  return new Set([...openSection.matchAll(/\|\s*(OB-\d{2})\s*\|/g)].map((m) => m[1]));
}

describe('T3Q capability governance', () => {
  const open = openBindingIds();

  it('blocks provider-verified claims while the gating binding is OPEN (UNE-side states stay reachable)', () => {
    // UNE_ADAPTER_READY is a UNE-side fact (adapter exists) and must remain
    // reachable under an OPEN binding — otherwise CC-125 would have to weaken
    // this guard (review M1). Only T3Q_*_VERIFIED claims are provider truth.
    for (const entry of T3Q_PLAN_FEATURE_CAPABILITIES) {
      if (entry.openBinding && open.has(entry.openBinding)) {
        expect(
          ['MOCK_ONLY', 'UNE_ADAPTER_READY'],
          `${entry.featureId} gated by OPEN ${entry.openBinding}`,
        ).toContain(entry.state);
      }
    }
  });

  it('keeps CONDITIONAL CR-T3Q entries without a binding at MOCK_ONLY (review N3)', () => {
    for (const entry of T3Q_PLAN_FEATURE_CAPABILITIES) {
      if (entry.requestId.startsWith('CR-T3Q-') && entry.openBinding === null) {
        expect(entry.state, `${entry.featureId} (CONDITIONAL, no binding)`).toBe('MOCK_ONLY');
      }
    }
  });

  it('requires a real evidence document for any T3Q_*_VERIFIED state', () => {
    for (const entry of T3Q_PLAN_FEATURE_CAPABILITIES) {
      if (entry.state === 'T3Q_DEV_VERIFIED' || entry.state === 'T3Q_PROD_VERIFIED') {
        // Evidence must be a CC evidence document, not an arbitrary repo file
        // (review N4 — an ADR path or `..` escape must not satisfy this).
        expect(entry.providerEvidence, `${entry.featureId} evidence path`).toMatch(
          /^docs\/evidence\/CC-\d{3}-[A-Za-z0-9-]+\.md$/,
        );
        const evidencePath = entry.providerEvidence as string;
        expect(
          existsSync(repoPath(evidencePath)),
          `${entry.featureId} evidence file exists: ${evidencePath}`,
        ).toBe(true);
        const evidenceBody = readRepoFile(...evidencePath.split('/'));
        expect(
          evidenceBody.includes(entry.featureId) || evidenceBody.includes(entry.requestId),
          `${evidencePath} mentions ${entry.featureId}/${entry.requestId}`,
        ).toBe(true);
      }
    }
  });

  it('requires an implemented adapter for UNE_ADAPTER_READY and above', () => {
    const order = ['MOCK_ONLY', 'UNE_ADAPTER_READY', 'T3Q_DEV_VERIFIED', 'T3Q_PROD_VERIFIED'];
    for (const entry of T3Q_PLAN_FEATURE_CAPABILITIES) {
      if (order.indexOf(entry.state) >= 1) {
        expect(entry.adapterImplemented, `${entry.featureId} adapter`).toBe(true);
      }
    }
  });

  it('keeps the registry and the target-v2 ProviderCapabilities.features keys in two-way sync', () => {
    const doc = loadYaml('contracts', 'openapi', 't3q-plan-api-change-request-v1.yaml');
    const schemas = (doc.components as { schemas: Record<string, unknown> }).schemas;
    const capabilities = schemas.ProviderCapabilities as {
      properties: { features: { properties: Record<string, unknown> } };
    };
    const contractKeys = Object.keys(capabilities.properties.features.properties).sort();
    // UNE-local ids with no contract features key, each with a reason
    // (review N2/R4: without this allowlist a typo id would slip in silently).
    const UNE_LOCAL_IDS: Record<string, string> = {
      legacyToc: 'RPT-001 — legacy 계약에는 capabilities API가 없음',
      legacyContent: 'RPT-002 — 〃',
      legacyDaily: 'RPT-003 — 〃',
      jobStatus: 'CR-T3Q-003 세분(계약 features는 jobSse/partialRetry만 노출)',
      jobCancel: 'CR-T3Q-003 세분 — 〃',
      capabilityDiscovery: 'CR-T3Q-009 자체(발견 API 그 자체라 features 키가 아님)',
    };
    const registryIds = T3Q_PLAN_FEATURE_CAPABILITIES.map((entry) => entry.featureId);
    const nonLocal = registryIds.filter((id) => !(id in UNE_LOCAL_IDS)).sort();
    expect(nonLocal).toEqual(contractKeys);
    for (const localId of Object.keys(UNE_LOCAL_IDS)) {
      expect(registryIds, `UNE-local id ${localId} still registered`).toContain(localId);
    }
  });

  it('references only binding ids that actually exist in OPEN_BINDINGS.md', () => {
    for (const entry of T3Q_PLAN_FEATURE_CAPABILITIES) {
      if (entry.openBinding) {
        expect(openBindings, `${entry.openBinding} documented`).toContain(entry.openBinding);
      }
    }
  });
});
