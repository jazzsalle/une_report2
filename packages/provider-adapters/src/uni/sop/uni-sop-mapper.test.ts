import { describe, expect, it } from 'vitest';
import { SOP_NODE_KEY_PATTERN, SOP_TITLE_MAX_LENGTH } from '@une/domain';
import { mapUniCompn, UNI_SOP_MAPPER_VERSION } from './uni-sop-mapper';

/**
 * UniSopMapper (설계 08 §1.11).
 *
 * 이 테스트가 어댑터 패키지에 있는 이유는 매퍼가 여기 있는 이유와 같다 —
 * provider 필드명을 아는 코드는 어댑터의 것이다(ADR-38 D18).
 */

describe('UniSopMapper', () => {
  it('compnSn/type/name/task/branch/source를 옮긴다', () => {
    const r = mapUniCompn(
      {
        compnSn: 'C1',
        type: 'ACTION',
        name: '대피 안내 방송',
        task: ['방송 송출', '수신 확인'],
        source: ['doc-1'],
      },
      1,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.node).toMatchObject({
      nodeKey: 'C1',
      providerNodeKey: 'C1',
      type: 'ACTION',
      title: '대피 안내 방송',
      sequence: 1,
      sourceRefs: ['doc-1'],
    });
    expect(r.value.node.tasks.map((t) => t.instruction)).toEqual(['방송 송출', '수신 확인']);
  });

  it('UNI 유형 별칭을 UNE 어휘로 옮긴다', () => {
    for (const [alias, expected] of [
      ['BEGIN', 'START'],
      ['task', 'ACTION'],
      ['STEP', 'ACTION'],
      ['branch', 'DECISION'],
      ['finish', 'END'],
    ] as const) {
      const r = mapUniCompn({ compnSn: 'x', type: alias }, 1);
      expect(r.ok && r.value.node.type, alias).toBe(expected);
    }
  });

  it('매퍼 버전이 있다 (어느 규칙으로 옮겼는지가 결과에 남는다)', () => {
    expect(UNI_SOP_MAPPER_VERSION).toBe('uni-sop-1');
  });

  describe('거부 — 그래프가 뜻을 잃는 경우만', () => {
    it('노드 키가 없으면 거부한다 (가리킬 수 없다)', () => {
      expect(mapUniCompn({ type: 'ACTION', name: 'x' }, 1)).toEqual({
        ok: false,
        reason: 'MISSING_NODE_KEY',
      });
    });

    it('모르는 유형은 거부한다 (실행기가 무엇을 할지 모른다)', () => {
      expect(mapUniCompn({ compnSn: 'c', type: 'TELEPORT' }, 1)).toEqual({
        ok: false,
        reason: 'UNKNOWN_NODE_TYPE',
      });
      expect(mapUniCompn({ compnSn: 'c' }, 1)).toEqual({
        ok: false,
        reason: 'UNKNOWN_NODE_TYPE',
      });
    });
  });

  describe('경고 — 설계가 "Validator warning으로 반환한다"고 정한 것', () => {
    it('제목이 없으면 경고하고 키로 대신한다 (노드를 버리지 않는다)', () => {
      const r = mapUniCompn({ compnSn: 'C9', type: 'ACTION', task: 'x' }, 1);
      expect(r.ok && r.value.warnings).toContain('MISSING_TITLE');
      expect(r.ok && r.value.node.title).toBe('C9');
    });

    it('ACTION에 임무가 없으면 경고한다', () => {
      const r = mapUniCompn({ compnSn: 'C1', type: 'ACTION', name: '무언가' }, 1);
      expect(r.ok && r.value.warnings).toContain('MISSING_TASK');
    });

    it('임무가 없어도 담당 없음을 알린다', () => {
      // 임무를 채우고 나면 담당은 여전히 비어 있다 — 그때 가서 다시 알리는
      // 경로가 없으므로 지금 알린다(ADR-38 수용 한계 6).
      const r = mapUniCompn({ compnSn: 'C1', type: 'ACTION', name: 'a' }, 1);
      expect(r.ok && r.value.warnings).toContain('MISSING_ASSIGNEE');
    });

    it('DECISION에 분기식이 없으면 경고한다', () => {
      const r = mapUniCompn({ compnSn: 'D1', type: 'DECISION', name: '판단' }, 1);
      expect(r.ok && r.value.warnings).toContain('MISSING_DECISION_EXPRESSION');
    });

    it('근거가 없으면 경고한다', () => {
      const r = mapUniCompn({ compnSn: 'C1', type: 'NOTE', name: 'n' }, 1);
      expect(r.ok && r.value.warnings).toContain('NO_SOURCE_REFS');
    });

    it('모르는 필드를 버렸다는 사실을 남긴다 (OB-04가 열려 있다)', () => {
      const r = mapUniCompn(
        { compnSn: 'C1', type: 'NOTE', name: 'n', source: ['d'], newField: 42 },
        1,
      );
      expect(r.ok && r.value.warnings).toContain('UNKNOWN_FIELD_DROPPED');
    });

    it('정상 노드에는 경고가 없다', () => {
      const r = mapUniCompn(
        { compnSn: 'D1', type: 'DECISION', name: '수위 판단', branch: 'level > 3', source: ['d'] },
        1,
      );
      expect(r.ok && r.value.warnings).toEqual([]);
    });

    it('DECISION이 아니면 분기식을 싣지 않는다', () => {
      const r = mapUniCompn(
        { compnSn: 'C1', type: 'ACTION', name: 'a', task: 't', branch: '쓸모없음', source: ['d'] },
        1,
      );
      expect(r.ok && r.value.node.decisionExpression).toBeNull();
    });
  });

  describe('저장 가능한 모양으로 맞춘다', () => {
    it('규칙에 맞지 않는 키를 고치고 원본을 남긴다', () => {
      const r = mapUniCompn({ compnSn: '대피 단계', type: 'ACTION' }, 7);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.node.nodeKey).toMatch(SOP_NODE_KEY_PATTERN);
      expect(r.value.node.providerNodeKey).toBe('대피 단계');
      expect(r.value.warnings).toContain('NODE_KEY_NORMALIZED');
    });

    it('제목이 컬럼 폭을 넘으면 자르고 알린다', () => {
      // 자르지 않으면 22001이 트랜잭션 전체를 되돌리고 잡이 엉뚱한 사유로 끝난다.
      const r = mapUniCompn({ compnSn: 'C1', type: 'NOTE', name: '가'.repeat(500) }, 1);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.node.title.length).toBe(SOP_TITLE_MAX_LENGTH);
      expect(r.value.warnings).toContain('TITLE_TRUNCATED');
    });
  });
});
