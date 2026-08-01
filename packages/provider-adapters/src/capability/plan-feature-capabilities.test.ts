import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_STATES,
  T3Q_PLAN_FEATURE_CAPABILITIES,
  getPlanFeatureCapability,
} from './plan-feature-capabilities';

/** Pure registry invariants (filesystem/doc cross-checks live in
 * tests/contract/src/capability-governance.test.ts). */
describe('T3Q plan feature capability registry', () => {
  it('has unique feature ids', () => {
    const ids = T3Q_PLAN_FEATURE_CAPABILITIES.map((entry) => entry.featureId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses only the four sanctioned states', () => {
    for (const entry of T3Q_PLAN_FEATURE_CAPABILITIES) {
      expect(CAPABILITY_STATES).toContain(entry.state);
    }
  });

  it('maps legacy entries to RPT ids and v2 entries to CR-T3Q ids', () => {
    for (const entry of T3Q_PLAN_FEATURE_CAPABILITIES) {
      expect(entry.requestId).toMatch(/^(RPT-00[123]|CR-T3Q-00[1-79])$/);
      if (entry.featureId.startsWith('legacy')) {
        expect(entry.requestId).toMatch(/^RPT-/);
      } else {
        expect(entry.requestId).toMatch(/^CR-T3Q-/);
      }
    }
  });

  // Written so a legitimate CC-125+ promotion never needs to delete this test
  // (review M1): the invariant is state ⇒ supporting flags, not a frozen
  // snapshot. As of the CC-115 baseline every entry is MOCK_ONLY (recorded in
  // docs/evidence/CC-115-t3q-contract-baseline-verification.md).
  it('never claims a state its flags do not justify', () => {
    for (const entry of T3Q_PLAN_FEATURE_CAPABILITIES) {
      if (entry.state !== 'MOCK_ONLY') {
        expect(entry.adapterImplemented, `${entry.featureId} adapter for ${entry.state}`).toBe(
          true,
        );
      }
      if (entry.state === 'T3Q_DEV_VERIFIED' || entry.state === 'T3Q_PROD_VERIFIED') {
        expect(
          entry.providerEvidence,
          `${entry.featureId} evidence for ${entry.state}`,
        ).not.toBeNull();
      }
      if (entry.providerEvidence === null) {
        expect(['MOCK_ONLY', 'UNE_ADAPTER_READY'], `${entry.featureId} without evidence`).toContain(
          entry.state,
        );
      }
    }
  });

  it('binds every v2 entry to OB-10/OB-11 except the CONDITIONAL CR-T3Q-007', () => {
    for (const entry of T3Q_PLAN_FEATURE_CAPABILITIES) {
      if (entry.featureId.startsWith('legacy')) continue;
      if (entry.requestId === 'CR-T3Q-007') {
        expect(entry.openBinding).toBeNull();
        expect(entry.notes).toContain('CONDITIONAL');
      } else {
        expect(['OB-10', 'OB-11']).toContain(entry.openBinding);
      }
    }
  });

  it('looks up entries by feature id', () => {
    expect(getPlanFeatureCapability('tocV2')?.requestId).toBe('CR-T3Q-001');
    expect(getPlanFeatureCapability('nope')).toBeUndefined();
  });
});
