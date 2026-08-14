import { HttpUniKnowledgeAdapter, type HttpUniKnowledgeConfig } from './http-uni-knowledge-adapter';
import { MockUniKnowledgeAdapter } from './mock-uni-knowledge-adapter';
import { DEFAULT_UNI_FIELD_NAMES } from './uni-knowledge-response.guard';
import type { UniKnowledgeProvider } from './uni-knowledge-port';

/**
 * UNI 지식문서 어댑터 선택 (CC-220, ADR-26 D6과 같은 형태).
 *
 *   mock (기본)  MockUniKnowledgeAdapter — UNE 상태기계 검증용
 *   http         HttpUniKnowledgeAdapter — 실 호출, 아직 provider 미검증
 *
 * 운영에서 mock을 쓰면 **기동하지 않는다.** 승인된 데모에서만
 * `UNE_ALLOW_MOCK_PROVIDER=true`로 연다 — T3Q 어댑터와 같은 규칙이며, mock을
 * 실 지원으로 보고하지 않기 위한 장치다.
 */

export const UNI_KNOWLEDGE_ADAPTERS = ['mock', 'http'] as const;
export type UniKnowledgeAdapterId = (typeof UNI_KNOWLEDGE_ADAPTERS)[number];

export interface UniKnowledgeFactoryEnv {
  UNE_UNI_KNOWLEDGE_ADAPTER?: string;
  UNE_UNI_BASE_URL?: string;
  UNE_UNI_USERNAME?: string;
  UNE_UNI_PASSWORD?: string;
  UNE_UNI_UPLOAD_FILE_FIELD?: string;
  UNE_UNI_TOKEN_FIELD?: string;
  UNE_UNI_LOGIN_ACCOUNT_FIELD?: string;
  UNE_UNI_UPLOAD_TIMEOUT_MS?: string;
  UNE_UNI_REQUEST_TIMEOUT_MS?: string;
  UNE_UNI_SEARCH_TIMEOUT_MS?: string;
  UNE_UNI_FIELD_SEARCH_RESULTS?: string;
  UNE_UNI_FIELD_CHUNK_ID?: string;
  UNE_UNI_FIELD_SCORE?: string;
  UNE_UNI_FIELD_TEXT?: string;
  UNE_UNI_FIELD_DOCUMENT_ID?: string;
  UNE_UNI_FIELD_FILE_NAME?: string;
  UNE_UNI_FIELD_MESSAGE?: string;
  UNE_UNI_FIELD_STATUS?: string;
  UNE_UNI_MOCK_SCENARIOS?: string;
  UNE_ALLOW_MOCK_PROVIDER?: string;
  NODE_ENV?: string;
}

function intFrom(v: string | undefined, fallback: number): number {
  if (v === undefined || v.trim() === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`정수(양수)여야 한다: ${v}`);
  }
  return n;
}

function required(env: UniKnowledgeFactoryEnv, key: keyof UniKnowledgeFactoryEnv): string {
  const v = env[key];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(
      `${key}가 필요하다 — UNI 실 어댑터는 어떤 값도 추측하지 않는다. ` +
        '틀린 기본값으로 호출하면 UNE의 결함이 UNI의 거절처럼 보인다 (OB-13).',
    );
  }
  return v.trim();
}

export function createUniKnowledgeProvider(env: UniKnowledgeFactoryEnv): UniKnowledgeProvider {
  const id = (env.UNE_UNI_KNOWLEDGE_ADAPTER ?? 'mock').trim() as UniKnowledgeAdapterId;
  if (!(UNI_KNOWLEDGE_ADAPTERS as readonly string[]).includes(id)) {
    throw new Error(
      `UNE_UNI_KNOWLEDGE_ADAPTER는 ${UNI_KNOWLEDGE_ADAPTERS.join('|')} 중 하나여야 한다: ${id}`,
    );
  }

  if (id === 'mock') {
    const isProd = env.NODE_ENV === 'production';
    if (isProd && env.UNE_ALLOW_MOCK_PROVIDER !== 'true') {
      throw new Error(
        'production에서 UNI mock 어댑터를 쓸 수 없다. 승인된 데모라면 ' +
          'UNE_ALLOW_MOCK_PROVIDER=true를 명시하라 — mock은 UNI 지원이 아니다.',
      );
    }
    // 시나리오 훅은 설정으로만 켜진다(ADR-33 D19와 같은 규칙). 켜지 않으면
    // 파일명이 무엇이든 정상 경로로 돈다.
    return new MockUniKnowledgeAdapter({
      scenariosEnabled: env.UNE_UNI_MOCK_SCENARIOS === 'true',
    });
  }

  const config: HttpUniKnowledgeConfig = {
    baseUrl: required(env, 'UNE_UNI_BASE_URL').replace(/\/+$/, ''),
    username: required(env, 'UNE_UNI_USERNAME'),
    password: required(env, 'UNE_UNI_PASSWORD'),
    // **CC-410에서 실측했으므로 기본값을 둔다.** `required`로 막아 둔 이유는
    // "틀린 기본값으로 호출하면 UNE의 결함이 UNI의 거절처럼 보인다"였다
    // (OB-13). 2026-08-14에 실 서버에서 값을 확인했으므로 그 근거가 사라졌다 —
    // 이제 기본값이 곧 실측값이다. 환경변수 재정의는 남긴다(UNI가 바꿀 수 있다).
    uploadFileField: env.UNE_UNI_UPLOAD_FILE_FIELD?.trim() || 'file',
    tokenField: env.UNE_UNI_TOKEN_FIELD?.trim() || 'token',
    loginAccountField: env.UNE_UNI_LOGIN_ACCOUNT_FIELD?.trim() || 'account',
    // 설계 08 §1.14: 업로드 60초. 나머지는 UNE 기준선이며 provider 합의값이 아니다.
    uploadTimeoutMs: intFrom(env.UNE_UNI_UPLOAD_TIMEOUT_MS, 60_000),
    requestTimeoutMs: intFrom(env.UNE_UNI_REQUEST_TIMEOUT_MS, 30_000),
    // 설계 08 §1.14: UNI Search 30초.
    searchTimeoutMs: intFrom(env.UNE_UNI_SEARCH_TIMEOUT_MS, 30_000),
    fieldNames: {
      documentId: env.UNE_UNI_FIELD_DOCUMENT_ID?.trim() || DEFAULT_UNI_FIELD_NAMES.documentId,
      fileName: env.UNE_UNI_FIELD_FILE_NAME?.trim() || DEFAULT_UNI_FIELD_NAMES.fileName,
      message: env.UNE_UNI_FIELD_MESSAGE?.trim() || DEFAULT_UNI_FIELD_NAMES.message,
      status: env.UNE_UNI_FIELD_STATUS?.trim() || DEFAULT_UNI_FIELD_NAMES.status,
      searchResults:
        env.UNE_UNI_FIELD_SEARCH_RESULTS?.trim() || DEFAULT_UNI_FIELD_NAMES.searchResults,
      chunkId: env.UNE_UNI_FIELD_CHUNK_ID?.trim() || DEFAULT_UNI_FIELD_NAMES.chunkId,
      score: env.UNE_UNI_FIELD_SCORE?.trim() || DEFAULT_UNI_FIELD_NAMES.score,
      text: env.UNE_UNI_FIELD_TEXT?.trim() || DEFAULT_UNI_FIELD_NAMES.text,
    },
  };

  if (!/^https?:\/\//.test(config.baseUrl)) {
    throw new Error(`UNE_UNI_BASE_URL은 http(s) URL이어야 한다: ${config.baseUrl}`);
  }

  return new HttpUniKnowledgeAdapter(config);
}
