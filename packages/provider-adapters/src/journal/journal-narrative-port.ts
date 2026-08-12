/**
 * 상황일지 서술 제안 포트 (CC-300, UNE-JNL-007).
 *
 * **여기에 LLM이 없다.** LLM·RAG는 T3Q 소유이고 UNE는 어댑터로만 부른다
 * (CLAUDE.md 범위 경계). 그런데 T3Q의 두 계약(현행 RPT-001/002, 요청한
 * target-v2) **어느 쪽에도 일지 서술 연산이 없다** — 그래서 지금 붙어 있는
 * 것은 규칙 기반 시뮬레이션 하나뿐이다(OB-03).
 *
 * CC-270의 채널과 같은 처지다: 포트는 실재하고, 어댑터는 자기가 시뮬레이션임을
 * 스스로 밝히며, **mock 성공을 T3Q 지원으로 보고하지 않는다.**
 */

export interface NarrativeProposalRequest {
  sectionKey: string;
  /** 지금 문장. 제안은 이것을 다듬는 것이다. */
  currentNarrative: string;
  /**
   * 사실. **제안은 이 값을 바꿀 수 없고 반박해서도 안 된다.**
   *
   * 어댑터에 넘기는 이유는 문장이 사실을 담을 수 있게 하기 위해서다 — 넘기지
   * 않으면 제안이 사실을 빠뜨리고, 그러면 사람이 손으로 채우게 된다.
   */
  factPayload: Record<string, unknown>;
  /** 어투·길이 같은 표현 규칙. 사실에는 영향을 주지 않는다. */
  styleRules: Record<string, unknown>;
}

export interface NarrativeProposal {
  sectionKey: string;
  proposedNarrative: string;
  /** 어댑터가 스스로 밝히는 것. 화면·기록·응답이 이 값을 함께 낸다. */
  simulated: boolean;
  adapterId: string;
  /** 원문 보존 — 나중에 "그때 무엇이 왔는가"를 물을 수 있어야 한다. */
  raw: Record<string, unknown>;
}

/**
 * DI 토큰. 서비스가 팩토리를 직접 부르면 배선을 모듈이 통제하지 못한다 —
 * 실 T3Q 어댑터가 왔을 때 서비스 코드를 고쳐야 하고, 시험 대역을 끼울 자리가
 * 없다(이중검토 M-6). 다른 provider(`OBJECT_STORAGE` 등)와 같은 방식이다.
 */
export const JOURNAL_NARRATIVE_PROVIDER = Symbol.for('une.journal.narrative-provider');

export interface JournalNarrativeProvider {
  readonly adapterId: string;
  /** 이 어댑터가 실제 provider를 부르는가. 지금은 전부 false다. */
  readonly isSimulated: boolean;
  propose(request: NarrativeProposalRequest): Promise<NarrativeProposal>;
}
