import { describe, expect, it } from 'vitest';
import { availableActions, completionBlockers, modeBadge, screenState, stepIndex } from './state';

describe('현장 화면 상태 (CC-280)', () => {
  it('담당자가 아니면 아무것도 누를 수 없다', () => {
    expect(availableActions('IN_PROGRESS', false)).toEqual([]);
  });

  it('상태마다 할 수 있는 것이 하나로 정해진다', () => {
    expect(availableActions('SENT', true)).toEqual(['ACKNOWLEDGE']);
    expect(availableActions('ACKNOWLEDGED', true)).toEqual(['START']);
    expect(availableActions('IN_PROGRESS', true)).toEqual([
      'REPORT_PROGRESS',
      'SUBMIT_COMPLETION',
      'REPORT_UNABLE',
    ]);
    // 첨부 UI가 아직 없으므로 어휘가 그것을 약속하지 않는다.
    expect(availableActions('IN_PROGRESS', true)).not.toContain('ADD_ATTACHMENT');
  });

  it('제출 후에는 담당자가 더 손대지 못한다', () => {
    // 첨부만 더할 수 있게 두면 "검토 중인 내용이 바뀌는" 상태가 된다.
    expect(availableActions('COMPLETION_SUBMITTED', true)).toEqual([]);
    expect(availableActions('COMPLETED', true)).toEqual([]);
  });

  it('전파 없이 만들어진 임무도 수신확인 버튼이 뜬다', () => {
    expect(availableActions('CREATED', true)).toEqual(['ACKNOWLEDGE']);
  });

  it('재배정된 옛 담당자에게는 읽기전용이라고 말한다', () => {
    const s = screenState({
      status: 'SENT',
      isAssignee: false,
      hasAssignee: true,
      runStatus: 'RUNNING',
      lastEventType: 'REASSIGNED',
    });
    expect(s.key).toBe('REASSIGNED');
  });

  it('아직 아무에게도 배정되지 않은 임무를 "넘어갔다"고 말하지 않는다', () => {
    // 재배정은 조직 단독으로도 되므로 사람이 비어 있는 임무가 실제로 생긴다.
    // 하나로 뭉치면 화면이 사실이 아닌 문장을 낸다.
    const s = screenState({
      status: 'SENT',
      isAssignee: false,
      hasAssignee: false,
      runStatus: 'RUNNING',
      lastEventType: null,
    });
    expect(s.key).toBe('UNASSIGNED');
    expect(s.tone).toBe('warn');
  });

  it('반려는 마지막 이벤트에서 읽는다 — 상태가 아니기 때문이다', () => {
    const plain = screenState({
      status: 'IN_PROGRESS',
      isAssignee: true,
      hasAssignee: true,
      runStatus: 'RUNNING',
      lastEventType: 'STARTED',
    });
    expect(plain.key).toBe('IN_PROGRESS');

    const afterReject = screenState({
      status: 'IN_PROGRESS',
      isAssignee: true,
      hasAssignee: true,
      runStatus: 'RUNNING',
      lastEventType: 'COMPLETION_REJECTED',
    });
    expect(afterReject.key).toBe('REJECTED');
    expect(afterReject.tone).toBe('warn');
  });

  it('실행이 멈춰 있으면 그 사실이 먼저 보인다', () => {
    const s = screenState({
      status: 'IN_PROGRESS',
      isAssignee: true,
      hasAssignee: true,
      runStatus: 'PAUSED',
      lastEventType: null,
    });
    expect(s.key).toBe('RUN_NOT_ACTIVE');
  });

  it('실제/훈련을 색상만으로 구분하지 않는다', () => {
    // 설계 09 SCR-TASK-001 인수기준.
    for (const mode of ['LIVE', 'EXERCISE', 'DRY_RUN']) {
      const badge = modeBadge(mode);
      expect(badge.text.length).toBeGreaterThan(0);
      expect(badge.mark.length).toBeGreaterThan(0);
    }
    expect(modeBadge('LIVE').text).not.toBe(modeBadge('EXERCISE').text);
  });

  it('Stepper는 정상 흐름 밖의 상태를 -1로 돌려준다', () => {
    expect(stepIndex('SENT')).toBe(0);
    expect(stepIndex('COMPLETED')).toBe(4);
    expect(stepIndex('UNABLE_REPORTED')).toBe(-1);
  });

  it('증거를 요구하는 항목이 있으면 화면도 첨부를 요구한다', () => {
    // 서버가 같은 규칙을 갖는다(validateCompletion). 화면이 minAttachments만
    // 보면 제출 버튼을 열어 주고 서버가 422를 내서 미리 거르는 목적이 무력해진다.
    const policy = {
      checklist: [{ key: 'a', label: '피해 확인', requiresEvidence: true }],
      minAttachments: 0,
      requireResult: true,
    };
    const blockers = completionBlockers(policy, {
      result: '확인함',
      checked: ['a'],
      attachmentCount: 0,
    });
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain('1개 이상');
    // 그리고 지금은 현장 앱에 첨부 화면이 없다는 사실을 감추지 않는다.
    expect(blockers[0]).toContain('첨부 등록 화면이 없어');
  });

  it('완료 전에 화면이 미리 걸러 왕복을 줄인다', () => {
    const policy = {
      checklist: [{ key: 'a', label: '대피 안내' }],
      minAttachments: 1,
      requireResult: true,
    };
    const blockers = completionBlockers(policy, { result: '', checked: [], attachmentCount: 0 });
    expect(blockers).toHaveLength(3);
    expect(
      completionBlockers(policy, { result: '했다', checked: ['a'], attachmentCount: 1 }),
    ).toEqual([]);
  });
});
