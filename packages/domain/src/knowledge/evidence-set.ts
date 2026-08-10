import { canonicalJson } from '../canonical-json';
import {
  isEvidenceEligible,
  type KnowledgeDocumentStatus,
  type UniProcessingStatus,
} from './knowledge-document';

/**
 * EvidenceSet — SOP 생성에 쓸 근거의 동결본 (CC-230).
 *
 * 설계 06 US-SIT-011(RAG 검색·Evidence 후보 검토·EvidenceSet 동결),
 * 설계 08 §1.14(UNI Search 30초·1회), 설계 10 UNE-KNOW-004~007.
 *
 * **화면 흐름 상태를 저장 상태로 쓰지 않는다.** US-SIT-011은 아홉 개의 상태를
 * 말한다(QUERY_READY·SEARCHING·RESULTS_READY·EVIDENCE_REVIEW·EVIDENCE_FROZEN·
 * NO_RESULTS·EVIDENCE_CONFLICT·SEARCH_ERROR·EVIDENCE_INVALID). 그 대부분은
 * **화면이 지금 무엇을 보여주는가**이지 DB에 남아야 하는 사실이 아니다 —
 * `SEARCHING`은 HTTP 요청이 진행 중이라는 뜻이고, `NO_RESULTS`는 항목이 0건인
 * DRAFT이며, `EVIDENCE_CONFLICT`는 항목들로부터 계산되는 파생값이다.
 *
 * 저장하는 것은 두 개다.
 *   DRAFT   검색 결과가 있고 사용자가 고르는 중이다. 항목을 바꿀 수 있다.
 *   FROZEN  생성 시점에 동결됐다. **불변이다.**
 *
 * CC-220이 `knowledge_document`에서 한 것과 같은 판단이다 — 0004의
 * `status varchar(20)`에 어휘가 없었고, 화면 상태를 그대로 밀어 넣으면 "지금
 * 화면이 무엇을 하는가"와 "이 자료가 무엇인가"를 구분할 수 없게 된다.
 */

export const EVIDENCE_SET_STATUSES = ['DRAFT', 'FROZEN'] as const;

export type EvidenceSetStatus = (typeof EVIDENCE_SET_STATUSES)[number];

export function isEvidenceSetStatus(v: unknown): v is EvidenceSetStatus {
  return (EVIDENCE_SET_STATUSES as readonly unknown[]).includes(v);
}

/** 설계 08 §1.14: UNI Search 30초, 1회. 재시도는 사용자 행동이다(E-01). */
export const EVIDENCE_SEARCH_TIMEOUT_MS = 30_000;

/** 설계 06 US-SIT-011 2단계 "기본 top_k=8". */
export const DEFAULT_TOP_K = 8;
export const MAX_TOP_K = 50;

export type EvidenceSearchBlocker =
  | 'SNAPSHOT_REQUIRED' // 확정 Snapshot이 선행조건이다
  | 'SNAPSHOT_NOT_CURRENT' // 낡은 판 위에서 근거를 모으면 SOP가 다른 사실을 가리킨다
  | 'NO_ELIGIBLE_DOCUMENT' // READY 문서가 하나도 없다
  | 'TOP_K_OUT_OF_RANGE';

/**
 * 검색을 시작할 수 있는가 (US-SIT-011 선행조건).
 *
 * "SituationSnapshot 확정, 0개 이상 READY 문서"가 선행조건이다. 문자 그대로는
 * 0개도 허용하지만, 0개면 UNI가 검색할 대상이 없어 A-01(검색결과 없음)로
 * 곧장 떨어진다 — 호출하기 전에 알 수 있는 것을 Provider에 물어보지 않는다.
 * 대신 이것은 **차단이 아니라 안내**여야 하므로 호출부가 422가 아닌 빈
 * 결과로 처리할 수 있도록 blocker를 따로 돌려준다.
 */
export function checkEvidenceSearchable(input: {
  currentSnapshotId: string | null;
  requestedSnapshotId: string;
  eligibleDocumentCount: number;
  topK: number;
}): EvidenceSearchBlocker | null {
  if (!input.currentSnapshotId) return 'SNAPSHOT_REQUIRED';
  // ADR-34 D17과 같은 축이다 — 근거는 **내가 본 판** 위에서 모아야 한다.
  // 낡은 Snapshot으로 검색하면 그 근거로 만든 SOP가 현재 상황과 다른 사실을
  // 가리키게 되고, EvidenceSet은 동결되므로 그 어긋남이 그대로 굳는다.
  if (input.requestedSnapshotId !== input.currentSnapshotId) return 'SNAPSHOT_NOT_CURRENT';
  if (!Number.isInteger(input.topK) || input.topK < 1 || input.topK > MAX_TOP_K) {
    return 'TOP_K_OUT_OF_RANGE';
  }
  if (input.eligibleDocumentCount <= 0) return 'NO_ELIGIBLE_DOCUMENT';
  return null;
}

/**
 * 이 문서를 근거로 쓸 수 있는가 — CC-220의 게이트를 그대로 소비한다.
 *
 * US-SIT-010 완료조건이 "READY 아닌 자료가 Evidence에 포함된 건 0"이고,
 * 그 판정은 두 축을 모두 봐야 한다(ADR-36 D1). 여기서 다시 구현하지 않는다.
 */
export function isUsableAsEvidence(doc: {
  status: KnowledgeDocumentStatus;
  uniStatus: UniProcessingStatus | null;
}): boolean {
  return isEvidenceEligible(doc.status, doc.uniStatus);
}

export type EvidenceItemRejection =
  | 'UNKNOWN_DOCUMENT' // UNI가 우리가 올린 적 없는 문서를 가리켰다 (E-02)
  | 'DOCUMENT_NOT_READY' // 우리 문서이지만 아직 근거 자격이 없다
  | 'EMPTY_QUOTE'; // 인용문이 없으면 근거로 보여줄 것이 없다

/**
 * UNI가 돌려준 청크 하나를 받아들일 수 있는가 (US-SIT-011 3단계·E-02).
 *
 * **E-02가 요구하는 것은 "결과 격리·사용금지"다.** UNI가 `doc_id`를 돌려줬는데
 * 그것이 우리가 이 테넌트에서 올린 문서가 아니면 그 청크는 근거가 아니다 —
 * 다른 기관의 자료일 수도 있고 UNI 쪽 잔여 데이터일 수도 있다. 무엇이든
 * **우리가 출처를 증명할 수 없는 것**이므로 EvidenceSet에 넣지 않는다.
 *
 * 이것이 인수기준 "authorization filter"의 실체다. 필터를 UNI 요청에만 걸고
 * 응답을 그대로 믿으면, 저쪽 필터가 틀렸을 때 우리가 알 방법이 없다.
 */
export function checkEvidenceItem(
  chunk: { documentId: string; quote: string },
  known: Map<string, { status: KnowledgeDocumentStatus; uniStatus: UniProcessingStatus | null }>,
): EvidenceItemRejection | null {
  const doc = known.get(chunk.documentId);
  if (!doc) return 'UNKNOWN_DOCUMENT';
  if (!isUsableAsEvidence(doc)) return 'DOCUMENT_NOT_READY';
  if (chunk.quote.trim().length === 0) return 'EMPTY_QUOTE';
  return null;
}

export type EvidenceFreezeBlocker =
  | 'ALREADY_FROZEN' // 동결은 한 번뿐이다
  | 'EMPTY_SELECTION'; // 근거 없는 EvidenceSet을 동결하면 SOP가 근거 없이 생성된다

/** 동결 가능한가 (UNE-KNOW-006). */
export function checkEvidenceFreezable(
  status: EvidenceSetStatus,
  selectedCount: number,
): EvidenceFreezeBlocker | null {
  if (status === 'FROZEN') return 'ALREADY_FROZEN';
  if (selectedCount <= 0) return 'EMPTY_SELECTION';
  return null;
}

export interface EvidenceHashInput {
  snapshotId: string;
  queryText: string;
  items: {
    knowledgeDocumentId: string;
    providerChunkId: string | null;
    rankNo: number;
    quoteText: string;
  }[];
}

/**
 * 동결 해시.
 *
 * **무엇을 넣지 않는가가 중요하다.** 동결자·동결시각·EvidenceSet id·점수는
 * 빠진다 — 이 해시가 답해야 하는 질문은 "같은 근거인가"이지 "같은 동결
 * 행위인가"가 아니다. 점수를 빼는 이유는 따로 있다: UNI가 같은 청크에 대해
 * 재현되지 않는 점수를 줄 수 있고(모델·색인이 바뀌면), 그러면 내용이 같은
 * 두 EvidenceSet의 해시가 달라진다.
 *
 * ADR-23 D4·ADR-34가 같은 규칙으로 Snapshot 해시를 정했다.
 *
 * 순서는 `rankNo`로 정규화한다 — 항목 배열의 물리적 순서에 해시가 의존하면
 * 저장 순서만 달라도 다른 값이 나온다.
 */
export function evidenceContentHashInput(input: EvidenceHashInput): string {
  const items = [...input.items]
    .sort((a, b) => a.rankNo - b.rankNo)
    .map((i) => ({
      knowledgeDocumentId: i.knowledgeDocumentId,
      providerChunkId: i.providerChunkId,
      rankNo: i.rankNo,
      quoteText: i.quoteText,
    }));
  return canonicalJson({ snapshotId: input.snapshotId, queryText: input.queryText, items });
}

/**
 * 검색 질의에서 개인정보를 줄인다 (US-SIT-011 1단계 "PII 최소화·프롬프트 기록").
 *
 * 질의는 Snapshot에서 파생되고 Snapshot에는 신고자 성명·연락처·주소가 들어올
 * 수 있다. 그것이 그대로 UNI로 나가면 `.claude/rules/security.md`의 "Mask or
 * minimize personal information in … provider requests"를 어긴다.
 *
 * **완벽한 익명화가 아니다.** 한국어 성명·전화·주민번호·이메일의 명백한 형태만
 * 가린다. 자유 서술 안의 개인정보는 잡지 못하며, 그 한계를 ADR에 남긴다 —
 * 여기서 "가렸다"고 단정하면 하지 않은 처리를 했다고 적는 것이 된다.
 */
export function minimizePii(text: string): string {
  return text
    .replace(/\d{6}\s*-\s*[1-4]\d{6}/g, '[주민번호]')
    .replace(/01[016-9]\s*-?\s*\d{3,4}\s*-?\s*\d{4}/g, '[연락처]')
    .replace(/0\d{1,2}\s*-\s*\d{3,4}\s*-\s*\d{4}/g, '[연락처]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[이메일]');
}
