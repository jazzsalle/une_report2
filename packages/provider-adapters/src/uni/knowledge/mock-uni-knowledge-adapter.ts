import {
  uniFailure,
  uniSuccess,
  type UniCallContext,
  type UniKnowledgeProvider,
  type UniKnowledgeResult,
  type UniReferenceOutcome,
  type UniSearchInput,
  type UniSearchOutcome,
  type UniStatusOutcome,
  type UniUploadInput,
  type UniUploadOutcome,
} from './uni-knowledge-port';

/**
 * UNI 지식문서 mock 어댑터 (CC-220).
 *
 * **이것은 UNI 지원이 아니다.** 이 어댑터는 `isMock=true`를 숨기지 않고 어떤
 * 로그도 이것을 실 연동으로 보고하지 않는다. (레지스트리의 `UNE_ADAPTER_READY`는
 * **실 HTTP 어댑터가 존재한다**는 뜻이지 mock의 상태가 아니다 — QA 검토 R5.)(CLAUDE.md: "Never report target mock
 * support as actual T3Q support" — UNI도 같다).
 *
 * 목적은 두 가지다.
 *   (1) 워커 파이프라인과 E2E가 UNI 없이 돌아간다. OB-13이 열려 있는 동안
 *       실 HTTP 경로는 검증할 수 없지만 **UNE 쪽 상태기계는 검증할 수 있다.**
 *   (2) 설계 08 §1.9의 수명주기를 그대로 재현한다 — 업로드 직후 QUEUED이고
 *       폴링할 때마다 PARSING → INDEXING → REFERENCE_GENERATING → READY로
 *       나아간다. 한 번에 READY가 되면 폴링 코드의 결함이 드러나지 않는다.
 *
 * 시나리오는 파일명으로 고르되 **기본은 꺼져 있다**(`scenariosEnabled`).
 * 처음에는 항상 켜 두었는데, 그러면 승인된 데모에서 운영자가 올린
 * `2026훈련계획.slow.pdf` 같은 실제 파일이 UNE가 지어낸 UNI 실패를
 * `knowledge_document.error_json`과 `provider_result`에 남긴다 — 시험 훅이
 * 운영 경로에 있는 것이고, ADR-33 D19(MockSituationProvider)와 ADR-26 D6
 * (MockLegacyT3qPlanAdapter)가 이미 같은 결함을 고쳤다. 테스트가 켜는 것을
 * 잊을 위험보다 운영 기록이 오염될 위험이 크다.
 *   `*.upload-fail.*`  업로드가 실패한다 (US-SIT-009 E-02)
 *   `*.uni-error.*`    등록은 되지만 처리가 ERROR로 끝난다 (US-SIT-010 E-02)
 *   `*.slow.*`         READY까지 폴링을 훨씬 많이 요구한다 (E-01 timeout 경로)
 *   `*.malformed.*`    계약 위반 응답 (가드가 거부해야 한다)
 */

const LIFECYCLE = ['QUEUED', 'PARSING', 'INDEXING', 'REFERENCE_GENERATING', 'READY'] as const;
const SLOW_EXTRA_STEPS = 40;

/**
 * 인스턴스마다 다른 문서 id 접두사.
 *
 * 없으면 모든 인스턴스가 `mock-doc-0001`부터 시작해, 여러 어댑터를 쓰는
 * 테스트에서 **다른 인스턴스의 문서를 자기 것으로 착각한다.** 실제로 그렇게
 * 됐다 — 폴링 스윕이 앞선 테스트의 문서까지 함께 집어 한 스윕에 수명주기가
 * 여러 칸 나아갔다. 난수가 아니라 증가 카운터라 결과는 여전히 결정적이다.
 */
let instanceSeq = 0;

interface MockDoc {
  documentId: string;
  fileName: string;
  polls: number;
  endsInError: boolean;
  slow: boolean;
}

export class MockUniKnowledgeAdapter implements UniKnowledgeProvider {
  readonly adapterId = 'mock-uni-knowledge';
  readonly mappingVersion = 'mock-1';
  readonly isMock = true;

  private readonly docs = new Map<string, MockDoc>();
  private seq = 0;
  private readonly prefix: string;
  private readonly scenariosEnabled: boolean;

  constructor(opts: { scenariosEnabled?: boolean } = {}) {
    instanceSeq += 1;
    this.prefix = `mock-doc-${instanceSeq}`;
    this.scenariosEnabled = opts.scenariosEnabled === true;
  }

  /** 파일명 훅은 시나리오가 켜졌을 때만 본다. */
  private scenario(fileName: string, token: string): boolean {
    return this.scenariosEnabled && fileName.includes(token);
  }

  private meta(
    operation: 'uploadDocument' | 'getDocumentStatus' | 'getReference' | 'searchEvidence',
  ) {
    return {
      adapterId: this.adapterId,
      mappingVersion: this.mappingVersion,
      operation,
      latencyMs: 0,
    };
  }

  async uploadDocument(
    input: UniUploadInput,
    _ctx: UniCallContext,
  ): Promise<UniKnowledgeResult<UniUploadOutcome>> {
    const raw = {
      requestSummary: {
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.content.byteLength,
        uploader: input.uploader,
        force: input.force,
      },
      responseBody: null as unknown,
    };

    if (this.scenario(input.fileName, '.upload-fail.')) {
      return uniFailure(
        {
          code: 'MOCK_PROVIDER_ERROR',
          message: 'mock: 업로드 실패 시나리오',
          retryable: true,
          sideEffectUncertain: false,
        },
        this.meta('uploadDocument'),
        raw,
      );
    }

    if (this.scenario(input.fileName, '.malformed.')) {
      // 가드가 거부해야 하는 모양 — doc_id가 없다.
      return uniFailure(
        {
          code: 'UNI_RESPONSE_CONTRACT_VIOLATION',
          message: 'mock: 업로드 응답에 문서 식별자가 없다',
          retryable: false,
          sideEffectUncertain: true,
        },
        this.meta('uploadDocument'),
        { ...raw, responseBody: { message: 'ok', filename: input.fileName } },
      );
    }

    this.seq += 1;
    const documentId = `${this.prefix}-${String(this.seq).padStart(4, '0')}`;
    this.docs.set(documentId, {
      documentId,
      fileName: input.fileName,
      polls: 0,
      endsInError: this.scenario(input.fileName, '.uni-error.'),
      slow: this.scenario(input.fileName, '.slow.'),
    });

    const body = { message: 'uploaded', filename: input.fileName, doc_id: documentId };
    return uniSuccess(
      { documentId, fileName: input.fileName, message: 'uploaded' },
      this.meta('uploadDocument'),
      { ...raw, responseBody: body },
    );
  }

  async getDocumentStatus(
    documentId: string,
    _ctx: UniCallContext,
  ): Promise<UniKnowledgeResult<UniStatusOutcome>> {
    const raw = { requestSummary: { documentId }, responseBody: null as unknown };
    const doc = this.docs.get(documentId);
    if (!doc) {
      return uniFailure(
        {
          code: 'UNI_ENDPOINT_NOT_FOUND',
          message: `mock: 모르는 문서 ${documentId}`,
          retryable: false,
          sideEffectUncertain: false,
        },
        this.meta('getDocumentStatus'),
        raw,
      );
    }

    doc.polls += 1;
    const steps = doc.slow ? LIFECYCLE.length + SLOW_EXTRA_STEPS : LIFECYCLE.length;
    const idx = Math.min(doc.polls, steps) - 1;
    const status =
      idx >= LIFECYCLE.length - 1
        ? doc.endsInError
          ? 'ERROR'
          : doc.slow && doc.polls < steps
            ? 'INDEXING'
            : 'READY'
        : LIFECYCLE[idx];

    const body = { doc_id: documentId, status };
    return uniSuccess({ documentId, status }, this.meta('getDocumentStatus'), {
      ...raw,
      responseBody: body,
    });
  }

  /**
   * 근거 검색 (CC-230).
   *
   * 받은 문서 목록에 대해 청크를 만든다. 자격 판정은 호출부의 일이다.
   *
   * 시나리오(켜졌을 때):
   *   `.no-results.` 질의  결과 0건 (US-SIT-011 A-01)
   *   `.foreign.` 질의     우리가 올린 적 없는 문서를 섞어 돌려준다 (E-02)
   */
  async searchEvidence(
    input: UniSearchInput,
    _ctx: UniCallContext,
  ): Promise<UniKnowledgeResult<UniSearchOutcome>> {
    const raw = {
      requestSummary: {
        query: input.query,
        topK: input.topK,
        documentCount: input.documentIds.length,
        filters: input.filters,
      },
      responseBody: null as unknown,
    };

    if (this.scenariosEnabled && input.query.includes('.no-results.')) {
      return uniSuccess({ chunks: [] }, this.meta('searchEvidence'), {
        ...raw,
        responseBody: { results: [] },
      });
    }

    // **호출부가 준 문서 목록을 그대로 쓴다.** 처음에는 mock의 내부 등록부에
    // 있고 READY인 것만 골랐는데, 그러면 이 mock을 통해 업로드를 거치지 않은
    // 테스트(API e2e는 문서를 DB에 직접 넣는다)에서 항상 0건이 된다. 자격
    // 판정은 이미 호출부가 마쳤고(도메인 isEvidenceEligible), 포트가 그것을
    // 다시 판정하는 것은 역할이 아니다.
    const chunks = input.documentIds.slice(0, input.topK).map((id, i) => ({
      documentId: id,
      chunkId: `${id}-c${i + 1}`,
      fileName: this.docs.get(id)?.fileName ?? null,
      score: Number((0.9 - i * 0.05).toFixed(6)),
      text: `mock 근거 ${i + 1}: ${input.query}`,
    }));

    if (this.scenariosEnabled && input.query.includes('.foreign.')) {
      // UNI가 우리가 올린 적 없는 문서를 가리키는 경우. 호출부가 걸러야 한다.
      chunks.push({
        documentId: 'foreign-doc-0001',
        chunkId: 'foreign-c1',
        fileName: 'someone-else.pdf',
        score: 0.99,
        text: '남의 기관 자료',
      });
    }

    return uniSuccess({ chunks }, this.meta('searchEvidence'), {
      ...raw,
      responseBody: { results: chunks },
    });
  }

  async getReference(
    documentId: string,
    _ctx: UniCallContext,
  ): Promise<UniKnowledgeResult<UniReferenceOutcome>> {
    const raw = { requestSummary: { documentId }, responseBody: null as unknown };
    const doc = this.docs.get(documentId);
    if (!doc) {
      return uniFailure(
        {
          code: 'UNI_ENDPOINT_NOT_FOUND',
          message: `mock: 모르는 문서 ${documentId}`,
          retryable: false,
          sideEffectUncertain: false,
        },
        this.meta('getReference'),
        raw,
      );
    }
    // 참조요약은 색인이 끝난 뒤에 생긴다 — 그전에는 202다(설계 08 §1.9).
    const ready = doc.polls >= LIFECYCLE.length && !doc.endsInError;
    const reference = ready ? { summary: `mock reference for ${doc.fileName}`, chunks: 3 } : null;
    return uniSuccess({ documentId, ready, reference }, this.meta('getReference'), {
      ...raw,
      responseBody: reference,
    });
  }
}
