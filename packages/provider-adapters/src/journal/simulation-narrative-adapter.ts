import type {
  JournalNarrativeProvider,
  NarrativeProposal,
  NarrativeProposalRequest,
} from './journal-narrative-port';

/**
 * 규칙 기반 서술 제안 (CC-300).
 *
 * **LLM이 아니다.** 사실칸의 값을 정해진 문형에 끼워 문장을 만들고 어투 규칙을
 * 적용할 뿐이다. 그래서 사실을 반박할 수 없고, 대신 사람이 기대하는 만큼
 * 좋아지지도 않는다 — 실제 개선은 T3Q 계약이 와야 한다(OB-03).
 *
 * 이것을 두는 이유는 두 가지다. 첫째, **사실 대조 게이트를 실제로 시험할 수
 * 있어야 한다** — 제안이 없으면 그 방어가 도는지 알 수 없다. 둘째, 포트가
 * 실재하면 실 어댑터가 왔을 때 호출부를 고치지 않는다.
 */
export class SimulationNarrativeAdapter implements JournalNarrativeProvider {
  readonly adapterId = 'journal-narrative-simulation-1';
  readonly isSimulated = true;

  async propose(request: NarrativeProposalRequest): Promise<NarrativeProposal> {
    const tone = typeof request.styleRules.tone === 'string' ? request.styleRules.tone : 'PLAIN';
    const sentences = describeFacts(request.factPayload);

    // 사실에서 뽑은 문장이 없으면 지금 문장을 그대로 둔다 — 지어내지 않는다.
    const body = sentences.length > 0 ? sentences.join(' ') : request.currentNarrative;
    const proposed = tone === 'FORMAL' ? toFormal(body) : body;

    return {
      sectionKey: request.sectionKey,
      proposedNarrative: proposed,
      simulated: true,
      adapterId: this.adapterId,
      raw: { tone, derivedFrom: Object.keys(request.factPayload), sentenceCount: sentences.length },
    };
  }
}

/** 사실칸을 문장으로. **값은 사실에서만 온다** — 그래서 반박이 구조적으로 없다. */
function describeFacts(fact: Record<string, unknown>): string[] {
  const out: string[] = [];
  const say = (key: string, format: (n: number) => string): void => {
    const v = fact[key];
    if (typeof v === 'number') out.push(format(v));
  };
  say('eventCount', (n) => `기간 안에 사실원장 ${n}건이 기록됐다.`);
  say('factCount', (n) => `확정된 사실은 ${n}건이다.`);
  say('entryCount', (n) => `대응 이벤트 ${n}건을 시간순으로 정리했다.`);
  say('taskCount', (n) => `임무 ${n}건을 수행했다.`);
  say('unresolvedCount', (n) =>
    n === 0 ? '미결 임무가 없다.' : `미결 임무 ${n}건이 남아 후속 조치가 필요하다.`,
  );
  return out;
}

function toFormal(text: string): string {
  return text
    .replace(/했다\./g, '하였습니다.')
    .replace(/됐다\./g, '되었습니다.')
    .replace(/이다\./g, '입니다.')
    .replace(/있다\./g, '있습니다.')
    .replace(/없다\./g, '없습니다.')
    .replace(/남았다\./g, '남았습니다.')
    .replace(/필요하다\./g, '필요합니다.');
}

/**
 * 어댑터 선택.
 *
 * 지금은 하나뿐이다. T3Q 계약이 오면 여기서 갈린다 — 호출부는 그대로다.
 */
export function createNarrativeProvider(): JournalNarrativeProvider {
  return new SimulationNarrativeAdapter();
}
