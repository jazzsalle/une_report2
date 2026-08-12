import { describe, expect, it } from 'vitest';
import { ApiError } from '../common/api-error';
import { parseGraphBody } from './sop.controller';

/**
 * 캔버스 본문 파싱 (UNE-SOP-006).
 *
 * 상태 전이·동시성·불변성은 e2e가 DB에 대고 증명한다. 여기서 보는 것은
 * **무엇을 400으로 막고 무엇을 검증 보고로 넘기는가**의 경계다.
 */

const START = { nodeKey: 'start', nodeType: 'START', title: '접수' };
const END = { nodeKey: 'fin', nodeType: 'END', title: '종료' };
const BASE = '11111111-1111-4111-8111-111111111111';

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
    return 'NO_ERROR';
  } catch (err) {
    return err instanceof ApiError ? err.code : 'UNKNOWN';
  }
};

describe('parseGraphBody', () => {
  it('노드와 간선을 옮긴다', () => {
    const parsed = parseGraphBody({
      baseVersionId: BASE,
      nodes: [START, END],
      edges: [{ fromNodeKey: 'start', toNodeKey: 'fin', priority: 2, label: '기본' }],
    });
    expect(parsed.baseVersionId).toBe(BASE);
    expect(parsed.nodes.map((n) => n.nodeKey)).toEqual(['start', 'fin']);
    expect(parsed.edges[0]).toEqual({
      fromNodeKey: 'start',
      toNodeKey: 'fin',
      conditionExpr: null,
      label: '기본',
      priority: 2,
    });
  });

  it('클라이언트가 보낸 매핑 경고를 믿지 않는다', () => {
    // 경고는 provider 산출물의 사실이다. 사람이 저장할 때 되돌려 받은 값을
    // 그대로 쓰면 "UNI가 이렇게 줬다"는 기록이 조작 가능해진다.
    const parsed = parseGraphBody({
      baseVersionId: BASE,
      nodes: [{ ...START, mappingWarnings: ['MISSING_TASK'] }],
      edges: [],
    });
    expect(parsed.nodes[0].warnings).toEqual([]);
  });

  it('좌표를 그대로 싣는다 (캔버스 배치는 절차가 아니다)', () => {
    const parsed = parseGraphBody({
      baseVersionId: BASE,
      nodes: [{ ...START, position: { x: 12.5, y: -3 } }],
      edges: [],
    });
    expect(parsed.nodes[0].position).toEqual({ x: 12.5, y: -3 });
  });

  describe('저장 자체가 불가능한 것만 400으로 막는다', () => {
    it('노드 키가 중복되면 막는다 (uk_sop_node_key가 23505를 던진다)', () => {
      expect(
        codeOf(() =>
          parseGraphBody({
            baseVersionId: BASE,
            nodes: [START, { ...START, title: '둘' }],
            edges: [],
          }),
        ),
      ).toBe('SOP-400-002');
    });

    it('본문에 없는 노드를 가리키는 간선을 막는다 (DB는 노드 id로 잇는다)', () => {
      expect(
        codeOf(() =>
          parseGraphBody({
            baseVersionId: BASE,
            nodes: [START],
            edges: [{ fromNodeKey: 'start', toNodeKey: '없음' }],
          }),
        ),
      ).toBe('SOP-400-002');
    });

    it('자기 자신을 가리키는 간선을 막는다 (ck_sop_edge_not_self)', () => {
      expect(
        codeOf(() =>
          parseGraphBody({
            baseVersionId: BASE,
            nodes: [START],
            edges: [{ fromNodeKey: 'start', toNodeKey: 'start' }],
          }),
        ),
      ).toBe('SOP-400-002');
    });

    it('노드 키 규칙과 유형을 강제한다', () => {
      expect(
        codeOf(() =>
          parseGraphBody({ baseVersionId: BASE, nodes: [{ ...START, nodeKey: '3' }], edges: [] }),
        ),
      ).toBe('SOP-400-002');
      expect(
        codeOf(() =>
          parseGraphBody({
            baseVersionId: BASE,
            nodes: [{ ...START, nodeType: 'TELEPORT' }],
            edges: [],
          }),
        ),
      ).toBe('SOP-400-002');
    });

    it('제목 길이를 컬럼 폭에 맞춰 막는다 (22001로 죽지 않는다)', () => {
      expect(
        codeOf(() =>
          parseGraphBody({
            baseVersionId: BASE,
            nodes: [{ ...START, title: '가'.repeat(301) }],
            edges: [],
          }),
        ),
      ).toBe('SOP-400-002');
    });
  });

  describe('검증 보고로 넘기는 것 — 고치는 중에는 저장돼야 한다', () => {
    it('시작만 있고 종료가 없어도 저장한다', () => {
      // 실행할 수 없는 그래프이지만, 저장하지 않으면 고칠 대상이 없다
      // (CC-240 D4와 같은 규칙).
      const parsed = parseGraphBody({ baseVersionId: BASE, nodes: [START], edges: [] });
      expect(parsed.nodes).toHaveLength(1);
    });

    it('연결이 하나도 없어도 저장한다', () => {
      const parsed = parseGraphBody({ baseVersionId: BASE, nodes: [START, END], edges: [] });
      expect(parsed.edges).toEqual([]);
    });
  });

  describe('요청 자체가 성립하지 않는 것', () => {
    it('baseVersionId가 없으면 거절한다', () => {
      expect(codeOf(() => parseGraphBody({ nodes: [START], edges: [] }))).toBe('SOP-6001');
    });

    it('노드가 하나도 없으면 거절한다', () => {
      expect(codeOf(() => parseGraphBody({ baseVersionId: BASE, nodes: [], edges: [] }))).toBe(
        'SOP-6001',
      );
    });

    it('노드 수 상한을 넘으면 거절한다', () => {
      const many = Array.from({ length: 501 }, (_, i) => ({ ...START, nodeKey: `n${i + 1}` }));
      expect(codeOf(() => parseGraphBody({ baseVersionId: BASE, nodes: many, edges: [] }))).toBe(
        'SOP-6001',
      );
    });
  });
});
