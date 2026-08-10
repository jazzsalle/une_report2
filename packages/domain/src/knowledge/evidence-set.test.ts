import { describe, expect, it } from 'vitest';
import {
  checkEvidenceFreezable,
  checkEvidenceItem,
  checkEvidenceSearchable,
  DEFAULT_TOP_K,
  EVIDENCE_SET_STATUSES,
  evidenceContentHashInput,
  isUsableAsEvidence,
  MAX_TOP_K,
  minimizePii,
} from './evidence-set';
import type { KnowledgeDocumentStatus, UniProcessingStatus } from './knowledge-document';

const SNAP = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const doc = (
  status: KnowledgeDocumentStatus,
  uniStatus: UniProcessingStatus | null,
): { status: KnowledgeDocumentStatus; uniStatus: UniProcessingStatus | null } => ({
  status,
  uniStatus,
});

describe('EvidenceSet 상태 어휘', () => {
  it('저장 상태는 둘뿐이다 (화면 흐름 상태를 넣지 않는다)', () => {
    // US-SIT-011은 아홉 개를 말하지만 대부분은 "화면이 지금 무엇을 하는가"다.
    // SEARCHING을 컬럼에 넣으면 HTTP 요청이 끝난 뒤 그 행이 무엇을 뜻하는지
    // 말할 수 없게 된다.
    expect([...EVIDENCE_SET_STATUSES]).toEqual(['DRAFT', 'FROZEN']);
    for (const screenOnly of ['SEARCHING', 'RESULTS_READY', 'NO_RESULTS', 'EVIDENCE_CONFLICT']) {
      expect(EVIDENCE_SET_STATUSES as readonly string[]).not.toContain(screenOnly);
    }
  });
});

describe('검색 선행조건 (US-SIT-011)', () => {
  const base = {
    currentSnapshotId: SNAP,
    requestedSnapshotId: SNAP,
    eligibleDocumentCount: 3,
    topK: DEFAULT_TOP_K,
  };

  it('확정 Snapshot과 READY 문서가 있으면 통과한다', () => {
    expect(checkEvidenceSearchable(base)).toBeNull();
  });

  it('확정된 판이 없으면 검색할 수 없다', () => {
    expect(checkEvidenceSearchable({ ...base, currentSnapshotId: null })).toBe('SNAPSHOT_REQUIRED');
  });

  it('낡은 판으로는 근거를 모을 수 없다 (동결되면 어긋남이 굳는다)', () => {
    expect(checkEvidenceSearchable({ ...base, requestedSnapshotId: OTHER })).toBe(
      'SNAPSHOT_NOT_CURRENT',
    );
  });

  it('근거 자격 문서가 없으면 UNI를 부르지 않는다', () => {
    expect(checkEvidenceSearchable({ ...base, eligibleDocumentCount: 0 })).toBe(
      'NO_ELIGIBLE_DOCUMENT',
    );
  });

  it('topK 범위를 검사한다', () => {
    expect(checkEvidenceSearchable({ ...base, topK: 0 })).toBe('TOP_K_OUT_OF_RANGE');
    expect(checkEvidenceSearchable({ ...base, topK: MAX_TOP_K + 1 })).toBe('TOP_K_OUT_OF_RANGE');
    expect(checkEvidenceSearchable({ ...base, topK: 1.5 })).toBe('TOP_K_OUT_OF_RANGE');
    expect(checkEvidenceSearchable({ ...base, topK: MAX_TOP_K })).toBeNull();
  });

  it('판 검사가 문서 수 검사보다 먼저다', () => {
    // 낡은 판이면 문서가 없다는 안내보다 판을 갱신하라는 안내가 맞다.
    expect(
      checkEvidenceSearchable({ ...base, requestedSnapshotId: OTHER, eligibleDocumentCount: 0 }),
    ).toBe('SNAPSHOT_NOT_CURRENT');
  });
});

describe('근거 자격은 CC-220 게이트를 그대로 쓴다', () => {
  it('두 축이 모두 맞아야 한다', () => {
    expect(isUsableAsEvidence(doc('REGISTERED', 'READY'))).toBe(true);
    expect(isUsableAsEvidence(doc('REGISTERED', 'INDEXING'))).toBe(false);
    expect(isUsableAsEvidence(doc('REGISTERED', null))).toBe(false);
    expect(isUsableAsEvidence(doc('CANCELLED', 'READY'))).toBe(false);
  });
});

describe('UNI 응답 청크 검사 (E-02 결과 격리·사용금지)', () => {
  const known = new Map([
    ['d-ready', doc('REGISTERED', 'READY')],
    ['d-indexing', doc('REGISTERED', 'INDEXING')],
  ]);

  it('우리 문서이고 READY이면 받아들인다', () => {
    expect(checkEvidenceItem({ documentId: 'd-ready', quote: '대피 절차' }, known)).toBeNull();
  });

  it('우리가 올린 적 없는 문서는 거부한다 (출처를 증명할 수 없다)', () => {
    // 이것이 "authorization filter"의 실체다. 요청에만 필터를 걸고 응답을
    // 그대로 믿으면 저쪽 필터가 틀렸을 때 알 방법이 없다.
    expect(checkEvidenceItem({ documentId: 'd-남의것', quote: 'x' }, known)).toBe(
      'UNKNOWN_DOCUMENT',
    );
  });

  it('우리 문서라도 근거 자격이 없으면 거부한다', () => {
    expect(checkEvidenceItem({ documentId: 'd-indexing', quote: 'x' }, known)).toBe(
      'DOCUMENT_NOT_READY',
    );
  });

  it('인용문이 비면 거부한다', () => {
    expect(checkEvidenceItem({ documentId: 'd-ready', quote: '   ' }, known)).toBe('EMPTY_QUOTE');
  });
});

describe('동결 (UNE-KNOW-006)', () => {
  it('선택된 근거가 있으면 동결할 수 있다', () => {
    expect(checkEvidenceFreezable('DRAFT', 2)).toBeNull();
  });

  it('두 번 동결할 수 없다', () => {
    expect(checkEvidenceFreezable('FROZEN', 2)).toBe('ALREADY_FROZEN');
  });

  it('빈 근거는 동결할 수 없다 (SOP가 근거 없이 생성된다)', () => {
    expect(checkEvidenceFreezable('DRAFT', 0)).toBe('EMPTY_SELECTION');
  });
});

describe('동결 해시', () => {
  const items = [
    { knowledgeDocumentId: 'a', providerChunkId: 'c1', rankNo: 1, quoteText: '첫째' },
    { knowledgeDocumentId: 'b', providerChunkId: 'c2', rankNo: 2, quoteText: '둘째' },
  ];

  it('같은 근거면 같은 값이다', () => {
    expect(evidenceContentHashInput({ snapshotId: SNAP, queryText: 'q', items })).toBe(
      evidenceContentHashInput({ snapshotId: SNAP, queryText: 'q', items }),
    );
  });

  it('배열 순서가 달라도 rankNo가 같으면 같은 값이다', () => {
    expect(
      evidenceContentHashInput({ snapshotId: SNAP, queryText: 'q', items: [...items].reverse() }),
    ).toBe(evidenceContentHashInput({ snapshotId: SNAP, queryText: 'q', items }));
  });

  it('근거가 달라지면 값이 달라진다', () => {
    const changed = [{ ...items[0], quoteText: '바뀜' }, items[1]];
    expect(evidenceContentHashInput({ snapshotId: SNAP, queryText: 'q', items: changed })).not.toBe(
      evidenceContentHashInput({ snapshotId: SNAP, queryText: 'q', items }),
    );
  });

  it('기준 판이 달라지면 값이 달라진다', () => {
    expect(evidenceContentHashInput({ snapshotId: OTHER, queryText: 'q', items })).not.toBe(
      evidenceContentHashInput({ snapshotId: SNAP, queryText: 'q', items }),
    );
  });

  it('점수는 해시에 없다 (UNI가 재현되지 않는 점수를 줄 수 있다)', () => {
    const withScore = items.map((i) => ({ ...i, score: 0.9 }));
    expect(evidenceContentHashInput({ snapshotId: SNAP, queryText: 'q', items: withScore })).toBe(
      evidenceContentHashInput({ snapshotId: SNAP, queryText: 'q', items }),
    );
  });
});

describe('질의 PII 최소화 (US-SIT-011 1단계)', () => {
  it('주민번호·연락처·이메일의 명백한 형태를 가린다', () => {
    expect(minimizePii('신고자 900101-1234567')).toContain('[주민번호]');
    expect(minimizePii('연락처 010-1234-5678')).toContain('[연락처]');
    expect(minimizePii('연락처 01012345678')).toContain('[연락처]');
    expect(minimizePii('전화 02-123-4567')).toContain('[연락처]');
    expect(minimizePii('메일 hong@example.com')).toContain('[이메일]');
  });

  it('가린 뒤에는 원래 값이 남지 않는다', () => {
    const out = minimizePii('홍길동 010-1234-5678 hong@example.com');
    expect(out).not.toContain('010-1234-5678');
    expect(out).not.toContain('hong@example.com');
  });

  it('완벽한 익명화가 아니다 — 자유 서술의 성명은 남는다', () => {
    // 이 한계를 테스트로 고정한다. "가렸다"고 단정하면 하지 않은 처리를
    // 했다고 적는 것이 된다(ADR에 수용 한계로 남긴다).
    expect(minimizePii('신고자는 홍길동입니다')).toContain('홍길동');
  });

  it('업무 문구는 건드리지 않는다', () => {
    const q = '태풍 대응 단계별 조치와 기관 임무';
    expect(minimizePii(q)).toBe(q);
  });
});
