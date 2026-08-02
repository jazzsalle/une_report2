import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  T3Q_PLAN_FEATURE_CAPABILITIES,
  TargetV2T3qPlanAdapter,
  describeRuntimeFeature,
  getPlanFeatureCapability,
} from '@une/provider-adapters';
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

  it('pins EVERY CR-T3Q-* feature to MOCK_ONLY while its requested contract is unaccepted (ADR-26 D7)', () => {
    // Generalization of the rule above (CC-125): UNE_ADAPTER_READY requires
    // 구현 ∧ 런타임 결선 ∧ live spec. A requested contract (CR-T3Q-*) is not a
    // live spec while its binding (OB-10/OB-11) is OPEN — an adapter against
    // it can only ever be MOCK_ONLY, no matter how complete the code is.
    for (const entry of T3Q_PLAN_FEATURE_CAPABILITIES) {
      if (!entry.requestId.startsWith('CR-T3Q-')) continue;
      if (entry.openBinding === null || open.has(entry.openBinding)) {
        expect(entry.state, `${entry.featureId} (${entry.requestId}, unaccepted)`).toBe(
          'MOCK_ONLY',
        );
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

  it('CC-135 mock 구현 완료가 CR-T3Q-* 상태를 승격시키지 못한다', () => {
    // CC-135로 target-v2 전 기능의 어댑터·mock이 갖춰졌다. 구현 완성도는
    // 승격 근거가 아니다(ADR-26 D7: 구현 ∧ 런타임 결선 ∧ live spec) — 대상
    // 계약이 미수락인 한 상태는 MOCK_ONLY로 고정된다.
    const implemented = T3Q_PLAN_FEATURE_CAPABILITIES.filter(
      (entry) => entry.requestId.startsWith('CR-T3Q-') && entry.adapterImplemented,
    );
    expect(implemented.length, 'CC-135 이후 구현된 CR-T3Q-* 기능 수').toBeGreaterThanOrEqual(10);
    for (const entry of implemented) {
      expect(entry.mockAvailable, `${entry.featureId} mockAvailable`).toBe(true);
      expect(entry.state, `${entry.featureId} (구현 완료 ≠ 승격)`).toBe('MOCK_ONLY');
      expect(entry.providerEvidence, `${entry.featureId} provider 증거 없음`).toBeNull();
      // 승격 차단 근거(열린 바인딩)가 실재해야 한다 — 근거 없는 고정은 governance가 아니다.
      expect(entry.openBinding, `${entry.featureId} 바인딩`).not.toBeNull();
      expect(open.has(entry.openBinding as string), `${entry.openBinding} 여전히 OPEN`).toBe(true);
    }
  });

  it('provider가 보고한 capabilities는 레지스트리를 승격시키지 못한다 (ADR-28 D11)', async () => {
    // 런타임 협상 결과가 정본을 바꿀 수 있다면 mock이 스스로를 T3Q 지원으로
    // 승격시킬 수 있다. 실제 어댑터를 호출해 그 경로가 없음을 실측한다.
    const adapter = new TargetV2T3qPlanAdapter();
    const result = await adapter.discoverCapabilities({ correlationId: 'corr-capability-gov' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.providerBuild.startsWith('une-mock-'), result.data.providerBuild).toBe(true);
    const advertised = Object.entries(result.data.features).filter(([, flag]) => flag);
    expect(advertised.length, 'true로 보고된 기능이 실제로 존재').toBeGreaterThanOrEqual(7);
    for (const [featureId] of advertised) {
      const entry = getPlanFeatureCapability(featureId);
      expect(entry, `${featureId} 레지스트리 등록`).toBeDefined();
      expect(entry?.state, `${featureId}: provider 보고 true여도 등록 상태 불변`).toBe('MOCK_ONLY');
    }
  });

  it('mock 어댑터의 세부 기능 상태가 사람이 읽는 줄에서 MOCK으로 드러난다 (CC-135 AC5)', () => {
    const adapter = new TargetV2T3qPlanAdapter();
    expect(adapter.runtimeMode).toBe('mock');
    const featureIds = [
      'semanticEdit',
      'evidenceSearch',
      'validation',
      'jobStatus',
      'jobSse',
      'jobCancel',
      'partialRetry',
      'capabilityDiscovery',
    ];
    for (const featureId of featureIds) {
      const line = describeRuntimeFeature(adapter, featureId);
      expect(line, featureId).toContain(featureId);
      expect(line, featureId).toContain('MOCK_ONLY');
      expect(line, featureId).toContain('MOCK RUNTIME');
      expect(line, featureId).toContain('실제 T3Q 지원 아님');
      expect(line, featureId).not.toContain('live transport');
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
