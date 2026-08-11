import { describe, expect, it } from 'vitest';
import {
  canCompleteRun,
  canReassign,
  canTransitionTask,
  FIELD_TASK_STATUSES,
  isTaskSettled,
  normalizeProgress,
  parseCompletionPolicy,
  validateCompletion,
} from './field-task';

describe('임무 상태 어휘 (CC-280)', () => {
  it('관측되지 않는 값을 넣지 않았다', () => {
    // 설계 09 Task 상태표의 열하나 중 셋이 빠져 있다. 그 셋을 되살리려는
    // 변경이 오면 여기서 걸린다.
    expect(FIELD_TASK_STATUSES).not.toContain('DELIVERED');
    expect(FIELD_TASK_STATUSES).not.toContain('REJECTED');
    expect(FIELD_TASK_STATUSES).not.toContain('REASSIGNED');
  });

  it('전파 없이 만들어진 임무도 수신확인할 수 있다', () => {
    // 모의 실행(DRY_RUN)은 전파를 하지 않는다. CREATED에서 곧장 받지 못하면
    // 모의로 절차를 한 걸음도 걸어볼 수 없다.
    expect(canTransitionTask('CREATED', 'ACKNOWLEDGED')).toBe(true);
  });

  it('수행 순서를 건너뛸 수 없다', () => {
    expect(canTransitionTask('SENT', 'IN_PROGRESS')).toBe(false);
    expect(canTransitionTask('ACKNOWLEDGED', 'COMPLETION_SUBMITTED')).toBe(false);
    expect(canTransitionTask('IN_PROGRESS', 'COMPLETED')).toBe(false);
  });

  it('완료 승인은 제출된 것에만 가능하다', () => {
    expect(canTransitionTask('COMPLETION_SUBMITTED', 'COMPLETED')).toBe(true);
    expect(canTransitionTask('IN_PROGRESS', 'COMPLETED')).toBe(false);
  });

  it('반려는 다시 수행 중으로 돌린다', () => {
    expect(canTransitionTask('COMPLETION_SUBMITTED', 'IN_PROGRESS')).toBe(true);
  });

  it('끝난 임무는 더 움직이지 않는다', () => {
    expect(isTaskSettled('COMPLETED')).toBe(true);
    expect(isTaskSettled('CANCELLED')).toBe(true);
    expect(isTaskSettled('UNABLE_REPORTED')).toBe(false);
    for (const to of FIELD_TASK_STATUSES) {
      expect(canTransitionTask('COMPLETED', to)).toBe(false);
      expect(canTransitionTask('CANCELLED', to)).toBe(false);
    }
  });

  it('재배정은 살아 있는 임무에만 된다', () => {
    expect(canReassign('SENT')).toBe(true);
    expect(canReassign('IN_PROGRESS')).toBe(true);
    expect(canReassign('UNABLE_REPORTED')).toBe(true);
    expect(canReassign('COMPLETED')).toBe(false);
    expect(canReassign('CANCELLED')).toBe(false);
  });
});

describe('실행 종료 판단', () => {
  it('모든 임무가 끝나야 실행이 끝난다', () => {
    expect(canCompleteRun(['COMPLETED', 'CANCELLED'])).toBe(true);
    expect(canCompleteRun(['COMPLETED', 'IN_PROGRESS'])).toBe(false);
  });

  it('수행불가로 남은 임무가 있으면 끝내지 않는다', () => {
    // 그것을 "끝났다"로 세면 아무도 하지 않은 절차 단계가 완료된 실행 안에
    // 조용히 남는다.
    expect(canCompleteRun(['COMPLETED', 'UNABLE_REPORTED'])).toBe(false);
  });

  it('임무가 하나도 없으면 끝났다고 말하지 않는다', () => {
    expect(canCompleteRun([])).toBe(false);
  });
});

describe('완료조건', () => {
  it('조건을 적지 않은 SOP도 결과 서술은 요구한다', () => {
    // "조건 없음"이 아니라 대개 아직 적지 못한 것이다. 빈 완료보고는
    // 상황일지에서 빈 칸이 된다.
    const policy = parseCompletionPolicy({});
    expect(policy.requireResult).toBe(true);
    expect(policy.minAttachments).toBe(0);
    expect(
      validateCompletion(policy, { result: '', checklist: [], attachmentCount: 0 }),
    ).toHaveLength(1);
    expect(
      validateCompletion(policy, { result: '통보 완료', checklist: [], attachmentCount: 0 }),
    ).toHaveLength(0);
  });

  it('첨부를 기본으로 요구하지 않는다', () => {
    // 사진을 찍을 수 없는 임무가 실제로 있다(전화 통보, 방송 요청).
    const policy = parseCompletionPolicy({ instructions: ['유선 통보'] });
    expect(
      validateCompletion(policy, { result: '완료', checklist: [], attachmentCount: 0 }),
    ).toHaveLength(0);
  });

  it('체크리스트를 다 채우지 않으면 항목마다 이유가 나온다', () => {
    const policy = parseCompletionPolicy({
      checklist: [
        { key: 'a', label: '대피 안내' },
        { key: 'b', label: '통제선 설치' },
      ],
    });
    const violations = validateCompletion(policy, {
      result: '했다',
      checklist: ['a'],
      attachmentCount: 0,
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].field).toBe('checklist.b');
    expect(violations[0].reason).toContain('통제선 설치');
  });

  it('증거를 요구하는 항목이 있으면 첨부가 하나는 있어야 한다', () => {
    const policy = parseCompletionPolicy({
      checklist: [{ key: 'a', label: '피해 확인', requiresEvidence: true }],
    });
    const withoutFile = validateCompletion(policy, {
      result: '확인',
      checklist: ['a'],
      attachmentCount: 0,
    });
    expect(withoutFile.map((v) => v.field)).toEqual(['attachments']);
    expect(
      validateCompletion(policy, { result: '확인', checklist: ['a'], attachmentCount: 1 }),
    ).toHaveLength(0);
  });

  it('minAttachments가 더 크면 그쪽이 이긴다', () => {
    const policy = parseCompletionPolicy({
      minAttachments: 3,
      checklist: [{ key: 'a', label: 'x', requiresEvidence: true }],
    });
    const violations = validateCompletion(policy, {
      result: 'ok',
      checklist: ['a'],
      attachmentCount: 2,
    });
    expect(violations[0].reason).toContain('3개 이상');
  });

  it('망가진 노드 설정을 만나도 조건이 사라지지 않는다', () => {
    const policy = parseCompletionPolicy({
      checklist: [{ label: 'key 없음' }, { key: 'ok', label: '정상' }, null],
      minAttachments: -5,
    });
    expect(policy.checklist.map((c) => c.key)).toEqual(['ok']);
    expect(policy.minAttachments).toBe(0);
  });
});

describe('진행률', () => {
  it('범위를 벗어나면 받지 않는다', () => {
    expect(normalizeProgress(-1)).toBeNull();
    expect(normalizeProgress(101)).toBeNull();
    expect(normalizeProgress('50')).toBeNull();
    expect(normalizeProgress(Number.NaN)).toBeNull();
  });

  it('소수점 둘째 자리까지 남긴다 (numeric(5,2))', () => {
    expect(normalizeProgress(33.333)).toBe(33.33);
    expect(normalizeProgress(100)).toBe(100);
    expect(normalizeProgress(0)).toBe(0);
  });
});
