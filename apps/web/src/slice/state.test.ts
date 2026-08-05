import { describe, expect, it } from 'vitest';
import { buildMockExternalToken } from './mock-sso';
import { STEPS, blockedReason, initialState, isJobOpen, reducer, type SliceState } from './state';

/**
 * CC-170 슬라이스 화면 상태.
 *
 * 선행 조건을 상태에서 읽어 화면에 적는 것이 이 모듈의 일이다. 그래서 검사할
 * 것은 "무엇을 못 하게 막는가"가 아니라 **왜 못 하는지 말하는가**다.
 */

const withUser: SliceState = {
  ...initialState,
  user: { userId: 'u1', tenantId: 't1' },
};

describe('blockedReason', () => {
  it('로그인 전에는 계획서 단계가 이유와 함께 막힌다', () => {
    expect(blockedReason(initialState, 'plan')).toContain('로그인');
    expect(blockedReason(initialState, 'login')).toBeNull();
  });

  it('생성 단계는 계획서와 Snapshot을 각각 구분해 말한다', () => {
    expect(blockedReason(withUser, 'generate')).toContain('계획서');
    const withPlan = { ...withUser, plan: { planId: 'p1' } as SliceState['plan'] };
    expect(blockedReason(withPlan, 'generate')).toContain('Snapshot');
    const ready = { ...withPlan, contextSnapshotId: 's1' };
    expect(blockedReason(ready, 'generate')).toBeNull();
  });

  it('Export는 문서가 있어야 한다', () => {
    expect(blockedReason(withUser, 'export')).toContain('HWPX');
  });
});

describe('reducer', () => {
  it('단계를 옮기면 이전 오류를 지운다 (다른 화면의 실패가 남지 않게)', () => {
    const failed = reducer(initialState, {
      type: 'FAIL',
      failure: { status: 422, code: 'X', message: 'y', recoverable: false },
    });
    expect(failed.failure).not.toBeNull();
    expect(reducer(failed, { type: 'STEP', step: 'plan' }).failure).toBeNull();
  });

  it('오류를 기록하면 busy가 풀린다 (버튼이 영원히 잠기지 않게)', () => {
    const busy = reducer(initialState, { type: 'BUSY', busy: true });
    const failed = reducer(busy, {
      type: 'FAIL',
      failure: { status: 500, code: 'X', message: 'y', recoverable: true },
    });
    expect(failed.busy).toBe(false);
  });

  it('로그는 최신이 앞이고 100건을 넘기지 않는다', () => {
    let state = initialState;
    for (let i = 0; i < 105; i += 1) {
      state = reducer(state, {
        type: 'LOG',
        entry: { at: `t${i}`, label: `call-${i}`, correlationId: 'c', ok: true },
      });
    }
    expect(state.log).toHaveLength(100);
    expect(state.log[0].label).toBe('call-104');
  });

  it('RESET은 상관관계 ID를 유지한다 (추적이 끊기지 않게)', () => {
    const traced = reducer(initialState, { type: 'TRACE', correlationId: 'corr_keep' });
    expect(reducer(traced, { type: 'RESET' }).correlationId).toBe('corr_keep');
  });
});

describe('isJobOpen', () => {
  it('중지 요청 중인 Job도 아직 열려 있다', () => {
    const job = (status: string): SliceState['tocJob'] =>
      ({ jobId: 'j', status }) as unknown as SliceState['tocJob'];
    expect(isJobOpen(job('QUEUED'))).toBe(true);
    expect(isJobOpen(job('RUNNING'))).toBe(true);
    expect(isJobOpen(job('CANCEL_REQUESTED'))).toBe(true);
    expect(isJobOpen(job('COMPLETED'))).toBe(false);
    expect(isJobOpen(job('FAILED'))).toBe(false);
    expect(isJobOpen(null)).toBe(false);
  });
});

describe('STEPS', () => {
  it('여섯 단계가 각자 어떤 API를 부르는지 밝힌다', () => {
    expect(STEPS).toHaveLength(6);
    for (const step of STEPS) expect(step.api).toMatch(/UNE-/);
  });
});

describe('buildMockExternalToken', () => {
  it('서버가 파싱하는 형식(mock. + base64url(JSON))을 만든다', () => {
    const token = buildMockExternalToken({
      tenantId: '00000000-0000-4000-8000-000000000001',
      loginId: 'admin-a',
    });
    expect(token.startsWith('mock.')).toBe(true);
    const payload = token.slice('mock.'.length).replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(payload)) as { tenantId: string; loginId: string };
    expect(decoded.loginId).toBe('admin-a');
  });

  it('base64url이므로 +와 /가 남지 않는다', () => {
    const token = buildMockExternalToken({
      tenantId: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
      loginId: '??>>??',
    });
    expect(token.slice(5)).not.toMatch(/[+/=]/);
  });
});
