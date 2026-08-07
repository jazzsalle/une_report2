import { describe, expect, it } from 'vitest';
import {
  SITUATION_STATUSES,
  canCollectFacts,
  canEditSituation,
  deriveContextState,
  isSituationClosed,
  isSituationMode,
  isSituationStatus,
  nextStatusOnFactRegistered,
} from '../index';

describe('CC-200 situation status — 설계 06 §7.1', () => {
  it('상태 어휘가 0023의 ck_situation_status와 같다', () => {
    // DB CHECK와 문자 그대로 같아야 INSERT가 23514로 떨어지지 않는다.
    expect([...SITUATION_STATUSES]).toEqual([
      'DRAFT',
      'REGISTERED',
      'CONTEXT_CONFIRMED',
      'SOP_READY',
      'RUNNING',
      'PAUSED',
      'CLOSING',
      'CLOSED',
    ]);
  });

  it('mode는 LIVE/EXERCISE 둘뿐이다', () => {
    expect(isSituationMode('LIVE')).toBe(true);
    expect(isSituationMode('EXERCISE')).toBe(true);
    expect(isSituationMode('ACTUAL')).toBe(false); // CC-004 픽스처가 쓰던 값
  });

  it('알 수 없는 상태를 받지 않는다', () => {
    expect(isSituationStatus('OPEN')).toBe(false);
    expect(isSituationStatus('DRAFT')).toBe(true);
  });

  describe('종결 경계', () => {
    it('CLOSING/CLOSED에서는 수집도 수정도 열지 않는다', () => {
      for (const status of ['CLOSING', 'CLOSED']) {
        expect(isSituationClosed(status)).toBe(true);
        expect(canCollectFacts(status)).toBe(false);
        expect(canEditSituation(status)).toBe(false);
      }
    });

    it('DRAFT에서 이미 Fact를 받는다 (US-SIT-003 #3 최초상황)', () => {
      expect(canCollectFacts('DRAFT')).toBe(true);
    });

    it('종결 전 상태는 모두 수집 가능하다', () => {
      for (const status of SITUATION_STATUSES.filter((s) => !isSituationClosed(s))) {
        expect(canCollectFacts(status)).toBe(true);
      }
    });
  });

  describe('첫 Fact 등록 시 상태 전이 (DRAFT → REGISTERED)', () => {
    it('DRAFT를 REGISTERED로 올린다', () => {
      expect(nextStatusOnFactRegistered('DRAFT')).toBe('REGISTERED');
    });

    it('그 이후 상태는 뒤로 돌리지 않는다', () => {
      expect(nextStatusOnFactRegistered('SOP_READY')).toBe('SOP_READY');
      expect(nextStatusOnFactRegistered('RUNNING')).toBe('RUNNING');
    });
  });

  describe('SituationContext 상태는 컬럼이 아니라 파생값이다 (0023 §8)', () => {
    it('후보가 없으면 DRAFT', () => {
      expect(
        deriveContextState({
          candidateFactCount: 0,
          openConflictCount: 0,
          currentSnapshotId: null,
        }),
      ).toBe('DRAFT');
    });

    it('후보가 있으면 CANDIDATE_REVIEW', () => {
      expect(
        deriveContextState({
          candidateFactCount: 3,
          openConflictCount: 0,
          currentSnapshotId: null,
        }),
      ).toBe('CANDIDATE_REVIEW');
    });

    it('OPEN 충돌이 후보 검토보다 앞선다 (CC-210 입력)', () => {
      expect(
        deriveContextState({
          candidateFactCount: 3,
          openConflictCount: 1,
          currentSnapshotId: null,
        }),
      ).toBe('CONFLICT_OPEN');
    });

    it('확정 Snapshot이 있으면 USER_CONFIRMED가 모두를 이긴다', () => {
      expect(
        deriveContextState({
          candidateFactCount: 3,
          openConflictCount: 2,
          currentSnapshotId: '00000000-0000-4000-8000-000000000001',
        }),
      ).toBe('USER_CONFIRMED');
    });

    it('PROVIDER_QUERYING은 동기 수집에서 관측되지 않는다 (ADR-33 D2)', () => {
      // 어떤 입력 조합으로도 나올 수 없다 — 입력에 그 상태의 근거가 없다.
      const states = new Set<string>();
      for (const candidateFactCount of [0, 1, 5]) {
        for (const openConflictCount of [0, 1]) {
          for (const currentSnapshotId of [null, '00000000-0000-4000-8000-000000000001']) {
            states.add(
              deriveContextState({ candidateFactCount, openConflictCount, currentSnapshotId }),
            );
          }
        }
      }
      expect(states.has('PROVIDER_QUERYING')).toBe(false);
    });
  });
});
