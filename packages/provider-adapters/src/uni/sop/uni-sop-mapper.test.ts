import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateSopGraph } from '@une/domain';
import { UNI_SOP_MAPPER_VERSION, mapUniCompn, resolveUniEdges } from './uni-sop-mapper';

/**
 * UniSopMapper 단위 시험 (CC-410).
 *
 * **인수기준 "test payload evidence"가 여기다.** 표본은 지어낸 것이 아니라
 * 2026-08-14에 실 UNI(`http://221.147.100.161:8000/chat/json`)에서 받은 SSE
 * 원문 세 벌이다(`__fixtures__/uni-chat-json-sample{1,2,3}.sse`). `__sources__`의
 * 사내 문서명·발췌와 생성문에 섞인 고객사명만 가렸고 **구조는 손대지 않았다** —
 * 매핑이 보는 것이 구조이므로, 가린 자리가 매핑 판정에 끼어들지 않는다.
 *
 * `uni-sop-1`의 시험은 설계 08 §1.11이 적은 필드명(`type`/`name`/`task`/
 * `branch`)으로 지어낸 표본을 썼고 **전부 통과했다**. 그런데도 실 UNI에서는
 * 한 노드도 매핑되지 않았다 — 지어낸 표본은 자기가 세운 가정을 다시 확인할 뿐
 * 가정이 틀렸다는 것은 영원히 말해 주지 않는다. 그래서 픽스처를 쓴다.
 */

// `import.meta`는 이 패키지의 tsconfig(module 설정)와 맞지 않는다. vitest는
// 소스 파일 경로를 `__filename`으로 준다.
const FIXTURE_DIR = resolve(dirname(__filename), '..', '__fixtures__');

const fixture = (n: 1 | 2 | 3): string =>
  readFileSync(resolve(FIXTURE_DIR, `uni-chat-json-sample${n}.sse`), 'utf8');

interface Parsed {
  compns: Record<string, unknown>[];
  doneCount: number | null;
}

function parse(sse: string): Parsed {
  const compns: Record<string, unknown>[] = [];
  let doneCount: number | null = null;
  for (const line of sse.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (payload === '[DONE]') continue;
    const obj = JSON.parse(payload) as Record<string, unknown>;
    if ('__compn__' in obj) compns.push(obj.__compn__ as Record<string, unknown>);
    if ('__done__' in obj) {
      const d = obj.__done__ as { count?: unknown };
      doneCount = typeof d.count === 'number' ? d.count : null;
    }
  }
  return { compns, doneCount };
}

function mapAll(n: 1 | 2 | 3) {
  const { compns, doneCount } = parse(fixture(n));
  const mapped = compns.map((raw, i) => mapUniCompn(raw, i + 1));
  const ok = mapped.flatMap((m) => (m.ok ? [m.value] : []));
  return { compns, doneCount, mapped, ok };
}

describe('UniSopMapper — 실 UNI 응답 3표본', () => {
  it('매퍼 버전이 실측 반영본이다', () => {
    expect(UNI_SOP_MAPPER_VERSION).toBe('uni-sop-2');
  });

  for (const n of [1, 2, 3] as const) {
    describe(`표본 ${n}`, () => {
      it('노드를 하나도 잃지 않는다', () => {
        const { compns, mapped, ok, doneCount } = mapAll(n);
        expect(compns.length).toBeGreaterThan(0);
        // `__done__.count`가 UNI가 보냈다고 주장하는 수다. 파싱과 매핑이 그것을
        // 둘 다 지켜야 "잃지 않았다"고 말할 수 있다.
        expect(compns.length).toBe(doneCount);
        expect(mapped.every((m) => m.ok)).toBe(true);
        expect(ok.length).toBe(compns.length);
      });

      it('제목·유형을 실제 필드에서 읽는다', () => {
        const { ok } = mapAll(n);
        // compnSj → title. 하나도 비면 안 된다.
        expect(ok.every((m) => m.node.title.length > 0)).toBe(true);
        expect(ok.some((m) => m.warnings.includes('MISSING_TITLE'))).toBe(false);
        // 104001은 3표본 모두 정확히 하나이고 그것이 시작이다.
        expect(ok.filter((m) => m.node.type === 'START')).toHaveLength(1);
        expect(ok.filter((m) => m.node.type === 'DECISION')).toHaveLength(1);
      });

      it('provider 키를 살려 둔다 (숫자여도)', () => {
        const { ok } = mapAll(n);
        // **여기가 uni-sop-1이 전량 탈락한 지점이다** — compnSn은 number다.
        expect(ok.every((m) => /^-?\d+$/.test(m.node.providerNodeKey))).toBe(true);
        // 키 규칙(^[A-Za-z]…)에 맞지 않으므로 고쳐 쓰고, 고쳤다고 말한다.
        expect(ok.every((m) => m.warnings.includes('NODE_KEY_NORMALIZED'))).toBe(true);
        expect(new Set(ok.map((m) => m.node.nodeKey)).size).toBe(ok.length);
      });

      it('분기 노드는 나가는 간선이 둘이다 (순번으로 이으면 사라진다)', () => {
        const { ok } = mapAll(n);
        const decision = ok.find((m) => m.node.type === 'DECISION');
        expect(decision).toBeDefined();
        expect(decision?.outgoing.length).toBe(2);
      });

      it('간선을 잇고, 오지 않은 종료 노드를 세운다', () => {
        const { ok } = mapAll(n);
        const { edges, synthesizedEnds } = resolveUniEdges(ok);
        // UNI는 마지막 노드가 가리키는 대상을 보내지 않는다 — 3표본 전부.
        expect(synthesizedEnds.length).toBeGreaterThan(0);
        const keys = new Set([
          ...ok.map((m) => m.node.nodeKey),
          ...synthesizedEnds.map((e) => e.nodeKey),
        ]);
        // 세우고 나면 매달린 간선이 없다.
        expect(edges.every((e) => keys.has(e.toNodeKey) && keys.has(e.fromNodeKey))).toBe(true);
        // 어느 provider 번호를 불렀는지 되짚을 수 있어야 한다.
        expect(synthesizedEnds.every((e) => /^-?\d+$/.test(e.providerNodeKey))).toBe(true);
      });

      it('세운 종료 노드까지 넣으면 그래프가 성립한다', () => {
        const { ok } = mapAll(n);
        const { edges, synthesizedEnds } = resolveUniEdges(ok);
        const nodes = [
          ...ok.map((m) => m.node),
          ...synthesizedEnds.map((e, i) => ({
            nodeKey: e.nodeKey,
            providerNodeKey: e.providerNodeKey,
            type: 'END' as const,
            title: '종료',
            sequence: ok.length + i + 1,
            tasks: [],
            decisionExpression: null,
            sourceRefs: [],
          })),
        ];
        const violations = validateSopGraph({ nodes, edges });
        // 종료 노드를 세우지 않으면 NO_END와 DANGLING_EDGE가 함께 선다.
        expect(violations).not.toContain('NO_END');
        expect(violations).not.toContain('DANGLING_EDGE');
        expect(violations).not.toContain('NO_START');
        expect(violations).not.toContain('MULTIPLE_START');
      });

      it('임무를 compnAttrbSaveParamsList에서 읽는다', () => {
        const { ok } = mapAll(n);
        const withTasks = ok.filter((m) => m.node.tasks.length > 0);
        expect(withTasks.length).toBeGreaterThan(0);
        expect(withTasks.every((m) => m.node.tasks.every((t) => t.instruction.length > 0))).toBe(
          true,
        );
      });

      it('작도 전용 키를 경고 없이 버린다', () => {
        const { ok } = mapAll(n);
        // 좌표·크기·색은 **모든** 노드에 있다. 그것으로 경고를 세우면 경고가
        // 전 노드에 붙어 아무 정보도 주지 못한다.
        const start = ok.find((m) => m.node.type === 'START');
        expect(start?.warnings).not.toContain('UNKNOWN_FIELD_DROPPED');
      });

      it('노드 단위 출처가 없다는 사실을 남긴다', () => {
        const { ok } = mapAll(n);
        // `__sources__`는 스트림 전체에 한 번 오고 doc_id도 없다. 노드↔근거를
        // 이을 방법이 provider에 없다 — 그래서 전 노드에 경고가 선다.
        expect(ok.every((m) => m.warnings.includes('NO_SOURCE_REFS'))).toBe(true);
        expect(ok.every((m) => m.node.sourceRefs.length === 0)).toBe(true);
      });
    });
  }
});

describe('UniSopMapper — 경계', () => {
  it('노드 키가 없으면 거부한다 (가리킬 수 없다)', () => {
    expect(mapUniCompn({ compnSj: '제목만' }, 1)).toEqual({
      ok: false,
      reason: 'MISSING_NODE_KEY',
    });
  });

  it('compnSn 0을 유효한 키로 본다', () => {
    // `!v`로 걸렀다면 0이 사라진다. 실측 값은 음수뿐이지만 0을 배제할 근거는 없다.
    const r = mapUniCompn({ compnSn: 0, compnTyCode: '104003', compnSj: 'x' }, 1);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.node.providerNodeKey).toBe('0');
  });

  it('모르는 유형 코드는 거부하지 않고 ACTION으로 세운 뒤 알린다', () => {
    // uni-sop-1은 거부했다. 유형 코드 표를 받지 못한 상태에서 거부하면 처음
    // 보는 코드 하나 때문에 사용자는 그 절차가 있었다는 사실조차 모른다.
    const r = mapUniCompn({ compnSn: -9, compnTyCode: '999999', compnSj: '새 유형' }, 1);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.node.type).toBe('ACTION');
    expect(r.ok && r.value.warnings).toContain('UNKNOWN_FIELD_DROPPED');
  });

  it('제목이 컬럼 폭(300)을 넘으면 자르고 알린다', () => {
    const r = mapUniCompn({ compnSn: -1, compnTyCode: '104003', compnSj: 'ㄱ'.repeat(400) }, 1);
    expect(r.ok && r.value.node.title).toHaveLength(300);
    expect(r.ok && r.value.warnings).toContain('TITLE_TRUNCATED');
  });

  it('정말 모르는 키는 여전히 알린다 (UNI가 필드를 늘리면 드러나야 한다)', () => {
    const r = mapUniCompn({ compnSn: -1, compnTyCode: '104003', compnSj: 'x', 처음보는필드: 1 }, 1);
    expect(r.ok && r.value.warnings).toContain('UNKNOWN_FIELD_DROPPED');
  });

  it('같은 대상을 여러 노드가 가리켜도 종료 노드는 하나만 선다', () => {
    const mapped = [
      {
        node: { nodeKey: 'n-5', providerNodeKey: '-5' },
        outgoing: [{ toProviderNodeKey: '-7', label: null }],
      },
      {
        node: { nodeKey: 'n-6', providerNodeKey: '-6' },
        outgoing: [{ toProviderNodeKey: '-7', label: null }],
      },
    ];
    const { edges, synthesizedEnds } = resolveUniEdges(mapped);
    expect(synthesizedEnds).toHaveLength(1);
    expect(edges).toHaveLength(2);
    expect(edges[0].toNodeKey).toBe(edges[1].toNodeKey);
  });
});
