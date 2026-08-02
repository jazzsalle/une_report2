import { describe, expect, it } from 'vitest';
import { CHANGE_OPERATION_TYPES, CHANGE_SET_ORIGINS } from '@une/domain';
import type { ErrorViolation } from '../common/api-error';
import {
  validateMutationId,
  validateOperations,
  validateOrigin,
  validateSelectionEnvelope,
  validateUuid,
} from './change-set.validator';

const REV = '3f1c1a52-2b0f-4a1e-9f2d-6c7b8a9d0e11';

function collect(fn: (violations: ErrorViolation[]) => void): ErrorViolation[] {
  const violations: ErrorViolation[] = [];
  fn(violations);
  return violations;
}

describe('SelectionEnvelope 구조 검증', () => {
  it('5종을 모두 받는다', () => {
    const envelopes: unknown[] = [
      { kind: 'CURSOR', baseRevisionId: REV, at: { paragraphId: 'P-1', offset: 0 } },
      {
        kind: 'TEXT_RANGE',
        baseRevisionId: REV,
        start: { paragraphId: 'P-1', offset: 0 },
        end: { paragraphId: 'P-1', offset: 3 },
      },
      { kind: 'BLOCK', baseRevisionId: REV, blockIds: ['P-1'] },
      { kind: 'SECTION', baseRevisionId: REV, sectionId: 'S-1' },
      { kind: 'TABLE_CELL', baseRevisionId: REV, tableId: 'T-1', cellId: 'C-1' },
    ];
    for (const envelope of envelopes) {
      expect(collect((v) => validateSelectionEnvelope(envelope, 'selection', v))).toEqual([]);
    }
  });

  it('화면좌표와 원시 XML 앵커는 이름만으로 거부한다(§1.8-4)', () => {
    for (const forbidden of ['x', 'y', 'rect', 'pixel', 'clientX', 'clientY', 'rawXmlAnchor']) {
      const violations = collect((v) =>
        validateSelectionEnvelope(
          { kind: 'BLOCK', baseRevisionId: REV, blockIds: ['P-1'], [forbidden]: 12 },
          'selection',
          v,
        ),
      );
      expect(violations.map((item) => item.field)).toContain(`selection.${forbidden}`);
    }
  });

  it('오프셋은 0 이상의 정수여야 한다(UTF-16 코드 단위 인덱스)', () => {
    for (const offset of [-1, 1.5, '3']) {
      const violations = collect((v) =>
        validateSelectionEnvelope(
          { kind: 'CURSOR', baseRevisionId: REV, at: { paragraphId: 'P-1', offset } },
          'selection',
          v,
        ),
      );
      expect(violations.map((item) => item.field)).toContain('selection.at.offset');
    }
  });

  it('알 수 없는 kind는 즉시 거부한다', () => {
    const violations = collect((v) =>
      validateSelectionEnvelope({ kind: 'PIXEL_RECT', baseRevisionId: REV }, 'selection', v),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].field).toBe('selection.kind');
  });
});

describe('연산 목록 구조 검증', () => {
  it('8종 어휘 밖의 연산을 거부한다', () => {
    const violations = collect((v) => validateOperations([{ type: 'INSERT_TEXT', order: 0 }], v));
    expect(violations[0].field).toBe('operations[0].type');
    expect(violations[0].reason).toContain(CHANGE_OPERATION_TYPES[0]);
  });

  it('order 중복을 요청 단계에서 막는다(uk_change_operation_order)', () => {
    const violations = collect((v) =>
      validateOperations(
        [
          {
            type: 'DELETE_RANGE',
            order: 0,
            selection: { kind: 'BLOCK', baseRevisionId: REV, blockIds: ['P-1'] },
          },
          {
            type: 'DELETE_RANGE',
            order: 0,
            selection: { kind: 'BLOCK', baseRevisionId: REV, blockIds: ['P-2'] },
          },
        ],
        v,
      ),
    );
    expect(violations.map((item) => item.reason)).toContain('order가 중복됩니다.');
  });

  it('빈 배열과 상한 초과를 거부한다', () => {
    expect(collect((v) => validateOperations([], v))[0].field).toBe('operations');
    const many = Array.from({ length: 201 }, (_, index) => ({
      type: 'DELETE_RANGE',
      order: index,
    }));
    expect(collect((v) => validateOperations(many, v))[0].field).toBe('operations');
  });

  it('materialize 소스의 planId/tocVersionId는 UUID여야 한다', () => {
    const violations = collect((v) =>
      validateOperations(
        [
          {
            type: 'INSERT_BLOCKS',
            order: 0,
            anchor: { relation: 'LAST_CHILD', ref: 'S-1' },
            source: { kind: 'GENERATED_BLOCKS', planId: 'plan-1', tocVersionId: REV },
          },
        ],
        v,
      ),
    );
    expect(violations.map((item) => item.field)).toContain('operations[0].source.planId');
  });

  it('세 소스 변형을 모두 받는다', () => {
    const sources: unknown[] = [
      { kind: 'INLINE', blocks: [{ text: '가' }] },
      { kind: 'PROTOTYPE', prototypeId: 'PROTO-1', count: 2 },
      { kind: 'GENERATED_BLOCKS', planId: REV, tocVersionId: REV },
    ];
    for (const source of sources) {
      expect(
        collect((v) =>
          validateOperations(
            [
              {
                type: 'INSERT_BLOCKS',
                order: 0,
                anchor: { relation: 'AFTER', ref: 'P-1' },
                source,
              },
            ],
            v,
          ),
        ),
      ).toEqual([]);
    }
  });

  it('anchor relation 어휘를 닫는다', () => {
    const violations = collect((v) =>
      validateOperations(
        [{ type: 'MOVE_BLOCK', order: 0, anchor: { relation: 'INSIDE', ref: 'P-1' } }],
        v,
      ),
    );
    expect(violations.map((item) => item.field)).toContain('operations[0].anchor.relation');
  });
});

describe('스칼라 검증', () => {
  it('clientMutationId는 멱등키 문자 집합을 따른다', () => {
    expect(collect((v) => validateMutationId('edit-01_a:b.c', 'clientMutationId', v))).toEqual([]);
    expect(collect((v) => validateMutationId('한글키', 'clientMutationId', v))).toHaveLength(1);
    expect(collect((v) => validateMutationId('x'.repeat(101), 'clientMutationId', v))).toHaveLength(
      1,
    );
  });

  it('origin은 7종만 허용한다', () => {
    for (const origin of CHANGE_SET_ORIGINS) {
      expect(collect((v) => validateOrigin(origin, v))).toEqual([]);
    }
    expect(collect((v) => validateOrigin('SYSTEM', v))).toHaveLength(1);
  });

  it('UUID가 아닌 baseRevisionId를 거부한다', () => {
    expect(collect((v) => validateUuid(REV, 'baseRevisionId', v))).toEqual([]);
    expect(collect((v) => validateUuid('rev-1', 'baseRevisionId', v))).toHaveLength(1);
  });
});
