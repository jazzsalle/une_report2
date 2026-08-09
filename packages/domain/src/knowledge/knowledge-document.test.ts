import { describe, expect, it } from 'vitest';
import {
  checkKnowledgeFile,
  checkKnowledgeRetryable,
  isEvidenceEligible,
  isPollExhausted,
  isScopeSelectableAtUpload,
  isSearchableWithoutReference,
  isTerminalKnowledgeStatus,
  KNOWLEDGE_DOCUMENT_STATUSES,
  UNI_POLL_MAX_ELAPSED_MS,
  UNI_PROCESSING_STATUSES,
  uniPollDelayMs,
} from './knowledge-document';

const MIME = new Set(['application/pdf']);
const POLICY = {
  maxSizeBytes: 1_000,
  allowedMimeTypes: MIME,
  allowScanPending: false,
};
const CLEAN_FILE = {
  uploadState: 'VERIFIED',
  scanStatus: 'CLEAN',
  sizeBytes: 100,
  mimeType: 'application/pdf',
};

describe('지식문서 상태 어휘', () => {
  it('두 축은 값이 겹치지 않는다 (한 컬럼에 밀어 넣지 않았다는 증거)', () => {
    // 겹치는 값이 생기면 "UNE가 아는 사실"과 "UNI가 알려준 사실"을 문자열만
    // 보고 구분할 수 없게 된다.
    const overlap = KNOWLEDGE_DOCUMENT_STATUSES.filter((s) =>
      (UNI_PROCESSING_STATUSES as readonly string[]).includes(s),
    );
    expect(overlap).toEqual([]);
  });

  it('종결 상태는 FAILED와 CANCELLED뿐이다', () => {
    expect(isTerminalKnowledgeStatus('FAILED')).toBe(true);
    expect(isTerminalKnowledgeStatus('CANCELLED')).toBe(true);
    expect(isTerminalKnowledgeStatus('REGISTERED')).toBe(false);
    expect(isTerminalKnowledgeStatus('UPLOADING')).toBe(false);
  });

  it('기관 KB는 업로드 시점에 고를 수 없다 (자동승격 금지)', () => {
    expect(isScopeSelectableAtUpload('THIS_INCIDENT')).toBe(true);
    expect(isScopeSelectableAtUpload('PROJECT')).toBe(true);
    expect(isScopeSelectableAtUpload('ORG_KB')).toBe(false);
  });
});

describe('근거 사용 자격 (US-SIT-010 완료조건)', () => {
  it('두 축이 모두 맞아야 근거가 된다', () => {
    expect(isEvidenceEligible('REGISTERED', 'READY')).toBe(true);
  });

  it('UNI가 READY라도 UNE가 취소했으면 근거가 아니다', () => {
    expect(isEvidenceEligible('CANCELLED', 'READY')).toBe(false);
    expect(isEvidenceEligible('FAILED', 'READY')).toBe(false);
  });

  it('등록됐어도 색인 중이면 근거가 아니다', () => {
    for (const s of ['QUEUED', 'PARSING', 'INDEXING', 'REFERENCE_GENERATING', 'ERROR'] as const) {
      expect(isEvidenceEligible('REGISTERED', s), s).toBe(false);
    }
  });

  it('아직 UNI 상태를 모르면 근거가 아니다 (null은 "모른다"이지 "됐다"가 아니다)', () => {
    expect(isEvidenceEligible('REGISTERED', null)).toBe(false);
  });

  it('참조요약 생성 중에도 검색은 가능하다 (A-01 별도 판정)', () => {
    expect(isSearchableWithoutReference('REGISTERED', 'REFERENCE_GENERATING')).toBe(true);
    expect(isSearchableWithoutReference('REGISTERED', 'INDEXING')).toBe(false);
    // 검색은 되지만 근거 자격은 아직 아니다 — 두 판정이 갈리는 지점.
    expect(isEvidenceEligible('REGISTERED', 'REFERENCE_GENERATING')).toBe(false);
  });
});

describe('재시도 가능 판정 (UNE-KNOW-003)', () => {
  it('전송 실패는 재시도할 수 있다', () => {
    expect(checkKnowledgeRetryable('FAILED', null, 1, 3)).toBeNull();
  });

  it('UNI 처리 실패도 재시도할 수 있다 (등록 자체는 성공했다)', () => {
    expect(checkKnowledgeRetryable('REGISTERED', 'ERROR', 1, 3)).toBeNull();
  });

  it('성공한 것은 재시도하지 않는다 (같은 문서가 UNI에 두 벌 생긴다)', () => {
    expect(checkKnowledgeRetryable('REGISTERED', 'READY', 1, 3)).toBe('NOT_FAILED');
    expect(checkKnowledgeRetryable('REGISTERED', 'INDEXING', 1, 3)).toBe('NOT_FAILED');
    expect(checkKnowledgeRetryable('UPLOADING', null, 1, 3)).toBe('NOT_FAILED');
  });

  it('취소한 것은 재시도가 아니라 재등록이다', () => {
    expect(checkKnowledgeRetryable('CANCELLED', null, 0, 3)).toBe('CANCELLED');
  });

  it('시도 횟수를 다 쓰면 막는다', () => {
    expect(checkKnowledgeRetryable('FAILED', null, 3, 3)).toBe('ATTEMPTS_EXHAUSTED');
    expect(checkKnowledgeRetryable('FAILED', null, 2, 3)).toBeNull();
  });
});

describe('업로드 전 파일 검사 (US-SIT-009 2단계·E-01)', () => {
  it('깨끗한 파일은 통과한다', () => {
    expect(checkKnowledgeFile(CLEAN_FILE, POLICY)).toBeNull();
  });

  it('악성코드 판정이 다른 무엇보다 먼저다', () => {
    // 검증도 안 됐고 크기도 넘지만, 사용자에게 말해야 하는 것은 감염이다.
    expect(
      checkKnowledgeFile(
        { uploadState: 'PENDING', scanStatus: 'INFECTED', sizeBytes: 99_999, mimeType: 'x/y' },
        POLICY,
      ),
    ).toBe('INFECTED');
  });

  it('업로드 검증을 통과하지 않은 파일은 거부한다', () => {
    expect(checkKnowledgeFile({ ...CLEAN_FILE, uploadState: 'PENDING' }, POLICY)).toBe(
      'NOT_VERIFIED',
    );
    expect(checkKnowledgeFile({ ...CLEAN_FILE, uploadState: 'ABORTED' }, POLICY)).toBe(
      'NOT_VERIFIED',
    );
  });

  it('검사 결과가 없으면 통과가 아니다 (OB-15 — 하지 않은 검사를 했다고 적지 않는다)', () => {
    expect(checkKnowledgeFile({ ...CLEAN_FILE, scanStatus: 'PENDING' }, POLICY)).toBe(
      'SCAN_PENDING',
    );
  });

  it('완화는 설정으로만 가능하고 그 사실이 설정에 남는다', () => {
    expect(
      checkKnowledgeFile(
        { ...CLEAN_FILE, scanStatus: 'PENDING' },
        { ...POLICY, allowScanPending: true },
      ),
    ).toBeNull();
    // 완화해도 감염 판정은 여전히 막는다.
    expect(
      checkKnowledgeFile(
        { ...CLEAN_FILE, scanStatus: 'INFECTED' },
        { ...POLICY, allowScanPending: true },
      ),
    ).toBe('INFECTED');
  });

  it('크기와 MIME을 검사한다', () => {
    expect(checkKnowledgeFile({ ...CLEAN_FILE, sizeBytes: 1_001 }, POLICY)).toBe('TOO_LARGE');
    expect(checkKnowledgeFile({ ...CLEAN_FILE, mimeType: 'application/zip' }, POLICY)).toBe(
      'MIME_NOT_ALLOWED',
    );
  });
});

describe('UNI 폴링 (설계 08 §1.14)', () => {
  it('설계가 적은 2/4/8/15초를 그대로 쓴다', () => {
    expect([0, 1, 2, 3].map(uniPollDelayMs)).toEqual([2_000, 4_000, 8_000, 15_000]);
  });

  it('네 번째 이후는 15초를 유지한다 (상한은 전체 경과시간이다)', () => {
    expect(uniPollDelayMs(4)).toBe(15_000);
    expect(uniPollDelayMs(99)).toBe(15_000);
  });

  it('음수 시도도 첫 간격으로 떨어진다', () => {
    expect(uniPollDelayMs(-1)).toBe(2_000);
  });

  it('5분이 지나면 폴링을 그만둔다', () => {
    expect(isPollExhausted(UNI_POLL_MAX_ELAPSED_MS - 1)).toBe(false);
    expect(isPollExhausted(UNI_POLL_MAX_ELAPSED_MS)).toBe(true);
  });
});
