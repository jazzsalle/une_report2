import { describe, expect, it } from 'vitest';
import {
  deriveSequentialEdges,
  validateSopGraph,
  type SopGraphDraft,
  type SopNodeDraft,
} from '@une/domain';
import { mapUniCompn } from './uni-sop-mapper';
import { MockUniSopAdapter } from './mock-uni-sop-adapter';
import { isRetryableUniSopError } from './uni-sop-port';
import {
  extractDataLines,
  parseUniSopLine,
  UniSopSseError,
  UNI_SOP_STREAM_TERMINATOR,
} from './uni-sop-sse.assumed';

const CTX = { correlationId: 'corr-sop' };
const req = (prompt: string) => ({
  prompt,
  documentIds: ['uni-doc-1'],
  snapshotId: '11111111-1111-4111-8111-111111111111',
  evidenceSetId: '22222222-2222-4222-8222-222222222222',
  schemaVersion: 'uni-sop-1',
});

describe('SSE 프레이밍 (UNE 가정 — OB-04)', () => {
  it('설계 08 §1.11의 여섯 이벤트를 옮긴다', () => {
    expect(parseUniSopLine('{"__status__":"generating"}').event).toEqual({
      kind: 'status',
      status: 'generating',
    });
    expect(parseUniSopLine('{"__thinking__":"음"}').event).toEqual({
      kind: 'thinking',
      text: '음',
    });
    expect(parseUniSopLine('{"__compn__":{"compnSn":"a"}}').event).toEqual({
      kind: 'compn',
      raw: { compnSn: 'a' },
    });
    expect(parseUniSopLine('{"__sources__":[{"doc_id":"d","chunk_id":"c"}]}').event).toEqual({
      kind: 'sources',
      sources: [{ documentId: 'd', chunkId: 'c' }],
    });
    expect(parseUniSopLine('{"__done__":{"node_count":3}}').event).toEqual({
      kind: 'done',
      nodeCount: 3,
    });
    expect(parseUniSopLine('{"__error__":"터졌다"}').providerError).toBe('터졌다');
  });

  it('[DONE]이 스트림을 닫는다', () => {
    const f = parseUniSopLine(UNI_SOP_STREAM_TERMINATOR);
    expect(f.terminated).toBe(true);
    expect(f.event).toBeNull();
  });

  it('모르는 이벤트 키는 버리되 원문은 남긴다', () => {
    // 파서가 죽으면 그때까지 받은 노드까지 잃는다 — 스트리밍에서 그 대가가 크다.
    const f = parseUniSopLine('{"__future__":{"x":1}}');
    expect(f.event).toBeNull();
    expect(f.raw).toEqual({ __future__: { x: 1 } });
  });

  it('모르는 상태값은 무시한다 (진행 표시일 뿐 그래프에 영향이 없다)', () => {
    expect(parseUniSopLine('{"__status__":"polishing"}').event).toBeNull();
  });

  it('프레이밍이 깨지면 던진다', () => {
    expect(() => parseUniSopLine('not json')).toThrow(UniSopSseError);
    expect(() => parseUniSopLine('[1,2]')).toThrow(UniSopSseError);
    expect(() => parseUniSopLine('{"__compn__":"객체가 아님"}')).toThrow(UniSopSseError);
  });

  it('data 줄만 뽑고 heartbeat 주석은 버린다', () => {
    const body = [': heartbeat', 'data: {"__status__":"searching"}', '', 'data: [DONE]'].join('\n');
    expect(extractDataLines(body)).toEqual(['{"__status__":"searching"}', '[DONE]']);
  });

  it('sources의 필드명 두 형태를 모두 받는다', () => {
    const f = parseUniSopLine('{"__sources__":[{"documentId":"d1"},{"doc_id":"d2"},{"x":1}]}');
    expect(f.event).toEqual({
      kind: 'sources',
      sources: [
        { documentId: 'd1', chunkId: null },
        { documentId: 'd2', chunkId: null },
      ],
    });
  });
});

describe('mock SOP 생성 — 실제 파서를 통과한다', () => {
  it('설계 08 §1.11의 순서대로 이벤트를 낸다', async () => {
    const uni = new MockUniSopAdapter({ scenariosEnabled: true });
    const r = await uni.generateSop(req('태풍 대응 절차'), CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const kinds = r.events.map((e) => e.kind);
    expect(kinds[0]).toBe('status');
    expect(kinds).toContain('sources');
    expect(kinds).toContain('compn');
    expect(kinds[kinds.length - 1]).toBe('done');
  });

  it('원문 프레임을 수신 순서 그대로 남긴다', async () => {
    const uni = new MockUniSopAdapter({ scenariosEnabled: true });
    const r = await uni.generateSop(req('q'), CTX);
    // 매핑 결과만 남기면 "UNI가 무엇을 보냈는가"에 답할 수 없다(OB-04).
    expect(r.raw.frames.length).toBeGreaterThan(5);
    expect(r.raw.frames[0]).toEqual({ __status__: 'searching' });
    // 프롬프트 원문은 남기지 않는다 — 길이만.
    expect(r.raw.requestSummary).toMatchObject({ promptLength: 1 });
    expect(JSON.stringify(r.raw.requestSummary)).not.toContain('"q"');
  });

  it('__done__ 없이 끊긴 스트림은 부분 결과가 아니라 오류다', async () => {
    const uni = new MockUniSopAdapter({ scenariosEnabled: true });
    const r = await uni.generateSop(req('.sop-truncated. 절차'), CTX);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('UNI_SOP_UNTERMINATED');
    // 이미 받은 노드 수를 알려준다 — 폐기 여부는 사용자 결정이다(§1.11).
    expect(r.error.partialNodeCount).toBeGreaterThan(0);
    expect(r.raw.frames.length).toBeGreaterThan(0);
  });

  it('__error__는 부분 노드 수와 함께 온다', async () => {
    const uni = new MockUniSopAdapter({ scenariosEnabled: true });
    const r = await uni.generateSop(req('.sop-error. 절차'), CTX);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('UNI_SOP_PROVIDER_REPORTED');
    expect(r.error.partialNodeCount).toBe(2);
    expect(r.error.retryable).toBe(true);
  });

  it('시나리오를 켜지 않으면 파일명·프롬프트가 무엇이든 정상 경로다', async () => {
    const uni = new MockUniSopAdapter();
    const r = await uni.generateSop(req('.sop-error. .sop-truncated.'), CTX);
    expect(r.ok).toBe(true);
  });

  it('자신이 mock임을 숨기지 않는다', () => {
    expect(new MockUniSopAdapter().isMock).toBe(true);
  });
});

describe('mock 스트림 → UniSopMapper → 그래프 검증 (설계 08 §1.11 전체 경로)', () => {
  const build = async (prompt: string): Promise<SopGraphDraft & { rejected: number }> => {
    const uni = new MockUniSopAdapter({ scenariosEnabled: true });
    const r = await uni.generateSop(req(prompt), CTX);
    const nodes: SopNodeDraft[] = [];
    let rejected = 0;
    let seq = 0;
    if (r.ok) {
      for (const e of r.events) {
        if (e.kind !== 'compn') continue;
        seq += 1;
        const m = mapUniCompn(e.raw, seq);
        if (!m.ok) {
          rejected += 1;
          continue;
        }
        nodes.push(m.value.node);
      }
    }
    // UNI는 간선을 주지 않는다 — 도착 순서로 잇는 것이 매퍼 규칙이다.
    return { nodes, edges: deriveSequentialEdges(nodes), rejected };
  };

  it('정상 스트림은 START → ACTION → END 그래프가 되고 검증을 통과한다', async () => {
    const g = await build('정상');
    expect(g.nodes.map((n) => n.type)).toEqual(['START', 'ACTION', 'END']);
    expect(g.rejected).toBe(0);
    expect(validateSopGraph(g)).toEqual([]);
  });

  it('깨진 노드는 거부되고 나머지는 살아남는다 (스트리밍이므로)', async () => {
    const g = await build('.sop-malformed. 절차');
    expect(g.rejected).toBe(1);
    // 거부된 노드 하나를 빼고 그래프가 성립한다 — 응답 전체를 버리지 않는다.
    expect(g.nodes.map((n) => n.type)).toEqual(['START', 'ACTION', 'END']);
    expect(validateSopGraph(g)).toEqual([]);
  });

  it('END 뒤에 노드가 더 오면 검증이 잡는다 (그래도 노드는 남는다)', async () => {
    const g = await build('.sop-after-end. 절차');
    expect(g.nodes.length).toBe(4);
    // DAG는 성립하고 END도 있다 — CYCLE·NO_END로는 잡히지 않는 위반이다.
    const v = validateSopGraph(g);
    expect(v).toContain('EDGE_FROM_END');
    expect(v).not.toContain('CYCLE');
    expect(v).not.toContain('NO_END');
    // 위반이 있어도 DRAFT로 남는다 — 고칠 대상이 없으면 고칠 수 없다.
    expect(g.nodes.map((n) => n.nodeKey).length).toBe(4);
  });
});

describe('오류 분류', () => {
  it('일시 장애는 재시도 대상이다', () => {
    expect(isRetryableUniSopError('UNI_SOP_TIMEOUT')).toBe(true);
    expect(isRetryableUniSopError('UNI_SOP_CONNECTION_ERROR')).toBe(true);
  });

  it('프레이밍 결함은 재시도해도 같다', () => {
    expect(isRetryableUniSopError('UNI_SOP_MALFORMED_STREAM')).toBe(false);
    expect(isRetryableUniSopError('UNI_SOP_REQUEST_REJECTED')).toBe(false);
  });
});
