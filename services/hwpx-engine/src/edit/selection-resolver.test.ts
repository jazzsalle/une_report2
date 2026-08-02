import type {
  BlockIR,
  DocumentIR,
  NodeAlias,
  RunIR,
  SelectionEnvelope,
  StyleRef,
} from '@une/domain';
import { describe, expect, it } from 'vitest';
import {
  fieldRegionsOf,
  isInStaticRegion,
  paragraphTextOf,
  resolveAlias,
  resolveSelection,
  runSpansOf,
  SELECTION_STALE_REVISION,
  SELECTION_UNRESOLVABLE,
} from './selection-resolver';
import type { ParagraphBlock } from './ir-lift';

/**
 * SelectionResolver 테스트 (설계 07 §1.8).
 *
 * 입력을 **손으로 만든 IR**로 쓴다. 서로게이트·결합문자·필드 쌍은 합성 HWPX
 * 픽스처에도 실 코퍼스에도 원하는 조합으로 존재하지 않고, 여기서 재려는 것은
 * 파서가 아니라 정규화 규칙이기 때문이다. 보안상 실 문서 본문은 쓰지 않는다.
 */

const STYLE: StyleRef = { paraPrId: 0, charPrId: 0, numberingId: null, styleId: 0 };
const PART = 'Contents/section0.xml';

function run(id: string, text: string, controls: string[] = []): RunIR {
  return { runId: id, text, charPrId: 0, controls };
}

function para(id: string, ordinal: number, runs: RunIR[], locked = false): ParagraphBlock {
  return {
    kind: 'PARAGRAPH',
    origin: 'SOURCE',
    paragraphId: id,
    runs,
    styleRef: STYLE,
    editState: { editedByUser: false, locked },
    rawXmlAnchor: `${PART}#p[${ordinal}]`,
  };
}

const P1 = para('P-1', 1, [run('R-1a', 'ab'), run('R-1b', 'cd')]);
// U+1F600은 UTF-16에서 2 코드유닛이다 — offset 5는 쌍 내부.
const P2 = para('P-2', 2, [run('R-2', '가나다다\u{1F600}x')]);
// 'e' + U+0301(결합 악센트).
const P3 = para('P-3', 3, [run('R-3', 'éf')]);
const P4 = para('P-4', 4, [
  run('R-4a', '앞', [`${PART}#p[4]/run[1]/fieldBegin[1]`]),
  run('R-4b', '필드값'),
  run('R-4c', '뒤', [`${PART}#p[4]/run[3]/fieldEnd[1]`]),
]);
const P5 = para('P-5', 5, [run('R-5', '잠김')], true);
const P6 = para('P-6', 6, [run('R-6', '셀문단')]);
const P7 = para('P-7', 7, [run('R-7', '표뒤')]);

const TABLE: BlockIR = {
  kind: 'TABLE',
  origin: 'SOURCE',
  tableId: 'TBL-1',
  rawXmlAnchor: `${PART}#p[6]/run[1]/tbl[1]`,
  rows: [
    {
      rowId: 'TR-1',
      cells: [{ cellId: 'TC-1', rowSpan: 1, colSpan: 1, blocks: [P6] }],
    },
  ],
};

const IR: DocumentIR = {
  irVersion: '2',
  documentId: 'DOC-1',
  revision: null,
  sourceHash: 'a'.repeat(64),
  sections: [
    {
      sectionId: 'SEC-1',
      partPath: PART,
      blocks: [P1, P2, P3, P4, P5, TABLE, P7],
      pageSettings: { rawXmlAnchor: `${PART}#sec[1]` },
    },
  ],
  styleIndex: { paraPr: [], charPr: [], style: [], numbering: [], bullet: [], binData: [] },
  unknownParts: [],
  findings: [],
};

const REV = 'rev-1';
const base = { ir: IR, currentRevisionId: REV };

function cursor(paragraphId: string, offset: number, revision = REV): SelectionEnvelope {
  return { kind: 'CURSOR', baseRevisionId: revision, at: { paragraphId, offset } };
}

describe('§1.8-1 baseRevision 검사', () => {
  it('불일치는 throw가 아니라 DOC-409-001(STALE_REVISION) 값으로 보고한다', () => {
    const result = resolveSelection(cursor('P-1', 0, 'rev-0'), base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SELECTION_STALE_REVISION);
    expect(result.latestRevisionId).toBe(REV);
    expect(result.violations[0].reason).toBe('UNDO_CONFLICT');
  });

  it('일치하면 통과한다', () => {
    expect(resolveSelection(cursor('P-1', 2), base).ok).toBe(true);
  });
});

describe('§1.8-2 노드 존재와 alias 재해석', () => {
  it('없는 문단은 DOC-422-004(NODE_NOT_FOUND)로 보고한다', () => {
    const result = resolveSelection(cursor('P-없음', 0), base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SELECTION_UNRESOLVABLE);
    expect(result.violations[0].reason).toBe('NODE_NOT_FOUND');
  });

  it('MERGE로 사라진 문단은 alias로 재해석되고 offset이 함께 밀린다', () => {
    const aliases: NodeAlias[] = [{ from: 'P-사라짐', to: 'P-1', offsetDelta: 2 }];
    const result = resolveSelection(cursor('P-사라짐', 1), { ...base, aliases });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selection.targetIds).toEqual(['P-1']);
    // 병합 전 오른쪽 문단의 1번 문자는 병합 후 3번 문자다.
    expect(result.selection.start?.offset).toBe(3);
    expect(result.selection.adjustments).toContain('ALIAS_REMAPPED');
  });

  it('alias 체인을 따라가되 순환에서 멈춘다', () => {
    const cyclic: NodeAlias[] = [
      { from: 'A', to: 'B', offsetDelta: 1 },
      { from: 'B', to: 'A', offsetDelta: 1 },
    ];
    expect(resolveAlias(cyclic, 'A')).toEqual({ id: 'B', offsetDelta: 1, remapped: true });
  });

  it('노드가 문서에 살아 있으면 alias를 밟지 않는다(복원·Undo 이후의 오편집 차단)', () => {
    // 복원이 병합 이전 상태로 되돌리면 P-1이 다시 존재한다. 그런데 append-only
    // alias 이력에는 "P-1 → P-2" 재사상이 그대로 남아 있다. 이때 재사상을
    // 그대로 밟으면 사용자가 P-1을 골랐는데 **P-2가 편집된다** — 오류 없이.
    const stale: NodeAlias[] = [{ from: 'P-1', to: 'P-2', offsetDelta: 5 }];
    const result = resolveSelection(cursor('P-1', 1), { ...base, aliases: stale });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selection.targetIds).toEqual(['P-1']);
    expect(result.selection.start?.offset).toBe(1);
    expect(result.selection.adjustments).not.toContain('ALIAS_REMAPPED');
  });

  it('exists를 주면 체인 중간에서도 살아 있는 노드에서 멈춘다', () => {
    const chain: NodeAlias[] = [
      { from: 'A', to: 'B', offsetDelta: 1 },
      { from: 'B', to: 'C', offsetDelta: 2 },
    ];
    expect(resolveAlias(chain, 'A', (id) => id === 'B')).toEqual({
      id: 'B',
      offsetDelta: 1,
      remapped: true,
    });
  });
});

describe('§1.8-3 정방향 정규화·잠금·정적영역·표 경계', () => {
  it('역방향 범위를 뒤집고 REVERSED를 보고한다', () => {
    const envelope: SelectionEnvelope = {
      kind: 'TEXT_RANGE',
      baseRevisionId: REV,
      start: { paragraphId: 'P-1', offset: 3 },
      end: { paragraphId: 'P-1', offset: 1 },
    };
    const result = resolveSelection(envelope, base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selection.start?.offset).toBe(1);
    expect(result.selection.end?.offset).toBe(3);
    expect(result.selection.adjustments).toContain('REVERSED');
  });

  it('문단이 다른 역방향 범위도 문서 순서로 뒤집는다', () => {
    const envelope: SelectionEnvelope = {
      kind: 'TEXT_RANGE',
      baseRevisionId: REV,
      start: { paragraphId: 'P-3', offset: 0 },
      end: { paragraphId: 'P-1', offset: 0 },
    };
    const result = resolveSelection(envelope, base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selection.targetIds).toEqual(['P-1', 'P-2', 'P-3']);
    expect(result.selection.adjustments).toContain('REVERSED');
  });

  it('잠긴 블록은 LOCKED_BLOCK으로 거부한다', () => {
    const result = resolveSelection(cursor('P-5', 0), base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map((item) => item.reason)).toContain('LOCKED_BLOCK');
  });

  it('정적영역 안의 블록은 STATIC_REGION으로 거부한다', () => {
    const result = resolveSelection(cursor('P-3', 0), {
      ...base,
      staticRegionAnchors: [`${PART}#p[3]`],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map((item) => item.reason)).toContain('STATIC_REGION');
  });

  it('정적영역이 블록 안에 있어도(문단 안 필드) 거부한다 — 판정은 양방향이다', () => {
    expect(isInStaticRegion(`${PART}#p[4]`, [`${PART}#p[4]/run[1]/fieldBegin[1]`])).toBe(true);
    expect(isInStaticRegion(`${PART}#p[4]`, [`${PART}#p[40]`])).toBe(false);
  });

  it('표 셀 안팎에 걸친 범위는 TABLE_BOUNDARY로 거부한다', () => {
    const envelope: SelectionEnvelope = {
      kind: 'TEXT_RANGE',
      baseRevisionId: REV,
      start: { paragraphId: 'P-1', offset: 0 },
      end: { paragraphId: 'P-6', offset: 1 },
    };
    const result = resolveSelection(envelope, base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map((item) => item.reason)).toContain('TABLE_BOUNDARY');
  });

  it('BLOCK 선택이 여러 컨테이너에 걸치면 거부한다', () => {
    const envelope: SelectionEnvelope = {
      kind: 'BLOCK',
      baseRevisionId: REV,
      blockIds: ['P-1', 'P-6'],
    };
    const result = resolveSelection(envelope, base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map((item) => item.reason)).toContain('TABLE_BOUNDARY');
  });
});

describe('§1.8-4 시각 좌표 미수용', () => {
  it('타입상 좌표 필드를 표현할 수 없다', () => {
    const envelope: SelectionEnvelope = {
      kind: 'CURSOR',
      baseRevisionId: REV,
      at: { paragraphId: 'P-1', offset: 0 },
      // @ts-expect-error §1.8-4: 화면 좌표는 Contract에 들어올 수 없다.
      clientX: 120,
    };
    expect(envelope.kind).toBe('CURSOR');
  });
});

describe('§1.8-5 offset 경계 스냅과 runSpans', () => {
  it('서로게이트 쌍 내부 offset을 뒤로 스냅한다', () => {
    // '가나다다' 4 + 이모지 2 = 인덱스 4,5가 쌍.
    const result = resolveSelection(cursor('P-2', 5), base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selection.start?.offset).toBe(4);
    expect(result.selection.adjustments).toContain('SURROGATE_PAIR');
  });

  it('결합문자 클러스터 내부 offset을 뒤로 스냅한다', () => {
    const result = resolveSelection(cursor('P-3', 1), base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selection.start?.offset).toBe(0);
    expect(result.selection.adjustments).toContain('COMBINING_MARK');
  });

  it('필드 제어문자 쌍 내부 offset을 쌍 시작으로 스냅한다', () => {
    expect(fieldRegionsOf(P4)).toEqual([{ start: 0, end: 5 }]);
    const result = resolveSelection(cursor('P-4', 3), base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selection.start?.offset).toBe(0);
    expect(result.selection.adjustments).toContain('FIELD_BOUNDARY');
  });

  it('문단 길이를 넘는 offset은 끝으로 잘린다', () => {
    const result = resolveSelection(cursor('P-1', 999), base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selection.start?.offset).toBe(paragraphTextOf(P1).length);
  });

  it('runSpans는 문단 내 누적 span이며 한 문단 선택에서만 실린다', () => {
    expect(runSpansOf(P1)).toEqual([
      { runId: 'R-1a', start: 0, end: 2 },
      { runId: 'R-1b', start: 2, end: 4 },
    ]);
    const single = resolveSelection(cursor('P-1', 1), base);
    expect(single.ok && single.selection.runSpans).toHaveLength(2);
    const multi = resolveSelection(
      {
        kind: 'TEXT_RANGE',
        baseRevisionId: REV,
        start: { paragraphId: 'P-1', offset: 0 },
        end: { paragraphId: 'P-3', offset: 0 },
      },
      base,
    );
    // 문단 ID가 없는 span 배열에 두 문단의 좌표를 섞지 않는다.
    expect(multi.ok && multi.selection.runSpans).toBeUndefined();
  });
});

describe('선택 유형 5종', () => {
  it('CURSOR는 collapsed range다', () => {
    const result = resolveSelection(cursor('P-1', 2), base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selection.start).toEqual(result.selection.end);
  });

  it('BLOCK은 비연속도 허용하되 문서 순서로 정렬한다', () => {
    const result = resolveSelection(
      { kind: 'BLOCK', baseRevisionId: REV, blockIds: ['P-4', 'P-1'] },
      base,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selection.targetIds).toEqual(['P-1', 'P-4']);
  });

  it('SECTION은 섹션의 최상위 블록 전체를 가리킨다', () => {
    // 잠긴 P-5를 뺀 문서. 섹션 선택은 표를 **블록 하나로** 잡고 셀 내부 문단을
    // 평면화하지 않는다 — 평면화하면 셀 안팎이 한 범위에 섞인다.
    const unlocked: DocumentIR = {
      ...IR,
      sections: [{ ...IR.sections[0], blocks: IR.sections[0].blocks.filter((b) => b !== P5) }],
    };
    const result = resolveSelection(
      { kind: 'SECTION', baseRevisionId: REV, sectionId: 'SEC-1' },
      { ir: unlocked, currentRevisionId: REV },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selection.targetIds).toEqual(['P-1', 'P-2', 'P-3', 'P-4', 'TBL-1', 'P-7']);
  });

  it('섹션에 잠긴 블록이 하나라도 있으면 섹션 선택이 거부된다', () => {
    const result = resolveSelection(
      { kind: 'SECTION', baseRevisionId: REV, sectionId: 'SEC-1' },
      base,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map((item) => item.reason)).toContain('LOCKED_BLOCK');
  });

  it('TABLE_CELL은 셀 경계 안으로 제한된다', () => {
    const ok = resolveSelection(
      {
        kind: 'TABLE_CELL',
        baseRevisionId: REV,
        tableId: 'TBL-1',
        cellId: 'TC-1',
        start: { paragraphId: 'P-6', offset: 0 },
        end: { paragraphId: 'P-6', offset: 2 },
      },
      base,
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.selection.targetIds).toEqual(['TC-1']);

    const outside = resolveSelection(
      {
        kind: 'TABLE_CELL',
        baseRevisionId: REV,
        tableId: 'TBL-1',
        cellId: 'TC-1',
        start: { paragraphId: 'P-1', offset: 0 },
        end: { paragraphId: 'P-1', offset: 1 },
      },
      base,
    );
    expect(outside.ok).toBe(false);
    if (!outside.ok) {
      expect(outside.violations.map((item) => item.reason)).toContain('TABLE_BOUNDARY');
    }
  });

  it('셀이 지정한 표에 속하지 않으면 거부한다', () => {
    const result = resolveSelection(
      { kind: 'TABLE_CELL', baseRevisionId: REV, tableId: 'TBL-없음', cellId: 'TC-1' },
      base,
    );
    expect(result.ok).toBe(false);
  });
});
