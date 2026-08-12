import { describe, expect, it } from 'vitest';
import {
  buildSopValidationReport,
  canApproveSopVersion,
  canEditSopGraph,
  canTransitionSop,
  SOP_LIFECYCLE_STATUSES,
  SOP_VALIDATOR_VERSION,
} from './sop-lifecycle';
import type { SopGraphDraft, SopNodeDraft } from './sop-graph';

const node = (nodeKey: string, type: SopNodeDraft['type']): SopNodeDraft => ({
  nodeKey,
  providerNodeKey: nodeKey,
  type,
  title: nodeKey,
  sequence: 1,
  tasks: [],
  decisionExpression: null,
  sourceRefs: [],
});

/** START → ACTION → END, 연결까지 성립하는 최소 그래프. */
const runnable = (): SopGraphDraft => ({
  nodes: [node('s', 'START'), node('a', 'ACTION'), node('e', 'END')],
  edges: [
    { fromNodeKey: 's', toNodeKey: 'a', conditionExpr: null, label: null, priority: 0 },
    { fromNodeKey: 'a', toNodeKey: 'e', conditionExpr: null, label: null, priority: 0 },
  ],
});

describe('SOP 상태 전이', () => {
  it('어휘는 셋이다 (RETIRED는 폐기 경로가 생길 때)', () => {
    expect([...SOP_LIFECYCLE_STATUSES]).toEqual(['DRAFT', 'IN_REVIEW', 'APPROVED']);
  });

  it('DRAFT → IN_REVIEW → APPROVED만 간다', () => {
    expect(canTransitionSop('DRAFT', 'IN_REVIEW')).toBe(true);
    expect(canTransitionSop('IN_REVIEW', 'APPROVED')).toBe(true);
    expect(canTransitionSop('DRAFT', 'APPROVED')).toBe(false);
  });

  it('승인에서 나가는 길이 없다 (정정은 새 버전이다)', () => {
    for (const to of SOP_LIFECYCLE_STATUSES) {
      expect(canTransitionSop('APPROVED', to), to).toBe(false);
    }
  });

  it('반려는 아직 없다 — 그 전이를 만드는 코드가 없다', () => {
    expect(canTransitionSop('IN_REVIEW', 'DRAFT')).toBe(false);
  });
});

describe('캔버스 편집 가능 상태', () => {
  it('DRAFT에서만 고친다', () => {
    expect(canEditSopGraph('DRAFT')).toBe(true);
  });

  it('검토 중에는 못 고친다 (검토자가 본 것이 바뀐다)', () => {
    expect(canEditSopGraph('IN_REVIEW')).toBe(false);
  });

  it('승인 후에는 못 고친다', () => {
    expect(canEditSopGraph('APPROVED')).toBe(false);
  });
});

describe('검증 보고 — 실행할 수 있는가로 가른다', () => {
  it('돌아가는 그래프는 PASS다', () => {
    const r = buildSopValidationReport(runnable());
    expect(r.status).toBe('PASS');
    expect(r.errors).toEqual([]);
    expect(r.validatorVersion).toBe(SOP_VALIDATOR_VERSION);
  });

  it('구조 위반은 오류다', () => {
    const g: SopGraphDraft = { nodes: [node('a', 'ACTION')], edges: [] };
    const r = buildSopValidationReport(g);
    expect(r.status).toBe('FAIL');
    expect(r.errors.map((e) => e.code).sort()).toEqual(['NO_END', 'NO_START']);
    // 사람이 읽을 문장이 함께 온다 — 코드만 주면 화면이 다시 번역해야 한다.
    expect(r.errors[0].message.length).toBeGreaterThan(0);
  });

  it('고립 노드도 오류다 (실행되지 않을 노드를 절차에 남기지 않는다)', () => {
    const g = runnable();
    g.nodes.push(node('x', 'ACTION'));
    expect(buildSopValidationReport(g).errors.map((e) => e.code)).toContain('ORPHAN_NODE');
  });

  it('매핑 경고는 통과를 막지 않는다', () => {
    const r = buildSopValidationReport(runnable(), [
      { nodeKey: 'a', warnings: ['MISSING_ASSIGNEE', 'NO_SOURCE_REFS'] },
    ]);
    expect(r.status).toBe('PASS');
    expect(r.warnings.map((w) => w.code)).toEqual(['MISSING_ASSIGNEE', 'NO_SOURCE_REFS']);
    // 어느 노드인지가 함께 와야 화면이 그 노드를 가리킬 수 있다.
    expect(r.warnings[0].nodeKey).toBe('a');
  });

  it('임무 없는 실행 노드는 오류다 (무엇을 할지가 없다)', () => {
    const r = buildSopValidationReport(runnable(), [{ nodeKey: 'a', warnings: ['MISSING_TASK'] }]);
    expect(r.status).toBe('FAIL');
    expect(r.errors.map((e) => e.code)).toContain('MISSING_TASK');
    expect(r.warnings.map((w) => w.code)).not.toContain('MISSING_TASK');
  });

  it('범위 밖 근거는 경고다 (승인 화면이 보여 주고 사람이 판단한다)', () => {
    const r = buildSopValidationReport(runnable(), [
      { nodeKey: 'a', warnings: ['SOURCE_OUT_OF_SCOPE'] },
    ]);
    expect(r.status).toBe('PASS');
    expect(r.warnings.map((w) => w.code)).toContain('SOURCE_OUT_OF_SCOPE');
  });
});

describe('승인 선행조건', () => {
  const base = {
    sopStatus: 'IN_REVIEW',
    versionStatus: 'DRAFT',
    latestValidation: 'PASS',
  } as const;

  it('검토 중 + 검증 통과면 승인한다', () => {
    expect(canApproveSopVersion({ ...base })).toEqual({ ok: true });
  });

  it('검토에 올리지 않은 것은 승인하지 않는다', () => {
    expect(canApproveSopVersion({ ...base, sopStatus: 'DRAFT' })).toEqual({
      ok: false,
      reason: 'NOT_IN_REVIEW',
    });
  });

  it('검증하지 않은 버전은 승인하지 않는다', () => {
    // 실행할 수 없는 절차가 "승인됨"으로 남으면 되돌릴 수 없다.
    expect(canApproveSopVersion({ ...base, latestValidation: null })).toEqual({
      ok: false,
      reason: 'NOT_VALIDATED',
    });
  });

  it('검증에 실패한 버전은 승인하지 않는다', () => {
    expect(canApproveSopVersion({ ...base, latestValidation: 'FAIL' })).toEqual({
      ok: false,
      reason: 'VALIDATION_FAILED',
    });
  });

  it('이미 고정된 버전은 다시 승인하지 않는다', () => {
    expect(canApproveSopVersion({ ...base, versionStatus: 'LOCKED' })).toEqual({
      ok: false,
      reason: 'ALREADY_LOCKED',
    });
  });
});
