export const API_CONFIG = 'API_CONFIG';

export interface ApiConfig {
  port: number;
  /** 'mock' issues UNE JWTs from mock identity assertions; anything else
   * disables issuance until the real T3Q SSO binding lands (OB-01). */
  authMode: 'mock' | 'disabled';
  /** HS256 signing key. Environment secret only — no default, never committed. */
  jwtSecret: string;
  accessTtlSec: number;
  refreshTtlSec: number;
  databaseUrl: string;
  /** SET LOCAL ROLE applied inside every transaction. Used by tests/CI that
   * connect with an admin URL but must exercise RLS as the runtime role;
   * production connects directly as une_app and leaves this unset. */
  runtimeRole?: string;
  /**
   * 업로드 티켓·다운로드 URL을 만들 때 쓰는 **외부에서 보이는** API 주소
   * (CC-170). presign을 할 수 없는 드라이버에서 클라이언트가 실제로 도달할 수
   * 있는 주소여야 한다. 리버스 프록시 뒤에서는 Host 헤더를 신뢰할 수 없으므로
   * 요청에서 유도하지 않고 설정으로 받는다.
   */
  publicBaseUrl: string;
  /** 업로드 상한. 선언 크기가 넘으면 사전등록 자체를 거부한다(FILE-422-001). */
  uploadMaxBytes: number;
  /** JSON 요청 본문 상한. 초과는 413 `COM-0413`이다. */
  jsonMaxBytes: number;
  /** 업로드 티켓 수명. 짧게 둔다 — 티켓은 인증 우회 경로다. */
  uploadTicketTtlSec: number;
  /**
   * 브라우저 허용 출처. 비면 CORS 헤더를 아예 내보내지 않는다(같은 출처만).
   * 와일드카드는 허용하지 않는다.
   */
  corsAllowedOrigins: readonly string[];
  /**
   * 상황 Provider 목업의 시나리오 훅(`query.mockScenario`)을 켠다.
   *
   * **기본값 false.** 시험 훅이 운영 요청 경로에 남으면 계약이 그 필드를
   * 약속하게 되므로, 켜는 것은 설정의 일이지 요청의 일이 아니다
   * (ADR-33 D19, CC-125 `scenariosEnabled` 선례).
   */
  situationMockScenarios: boolean;
  /**
   * Provider 한 곳당 수집 제한시간(ms).
   *
   * 동기 수집이라 이것이 없으면 느린 Provider **하나가 HTTP 요청을 무기한
   * 붙잡는다** — 목업은 즉시 끝나므로 드러나지 않을 뿐이다. 서킷브레이커·
   * 재시도 정책은 실 어댑터와 함께 오지만(ADR-33 수용 한계 2), 제한시간이
   * 아예 없는 것은 그때까지 미룰 수 있는 종류가 아니다(QA 리뷰 R-3).
   */
  situationProviderTimeoutMs: number;
  /**
   * 지식문서 업로드 상한 (CC-220, US-SIT-009 1단계 "허용형식/크기 검사").
   *
   * `uploadMaxBytes`와 따로 둔다 — 저장소에 올릴 수 있는 크기와 UNI가 받아
   * 학습할 수 있는 크기는 다른 값이고, 후자는 UNI 쪽 제약(OB-13)에 묶인다.
   */
  knowledgeMaxFileBytes: number;
  knowledgeAllowedMimeTypes: ReadonlySet<string>;
  /**
   * 악성코드 검사 결과가 없어도 등록을 허용하는가.
   *
   * **기본 false.** OB-15로 AV 엔진이 없어 `scan_status`는 영구 PENDING인데,
   * 그것을 통과로 보면 하지 않은 검사를 했다고 감사에 남는다(ADR-32 D3).
   * 완화가 필요하면 그 사실이 설정에 드러나야 한다.
   */
  knowledgeAllowScanPending: boolean;
  /** UNI 전송 시도 상한 (UNE-KNOW-003). */
  knowledgeMaxUploadAttempts: number;
}

function intEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const authMode = env.AUTH_MODE === 'mock' ? 'mock' : 'disabled';
  const jwtSecret = env.UNE_AUTH_JWT_SECRET ?? '';
  if (authMode === 'mock' && jwtSecret.length < 32) {
    throw new Error(
      'AUTH_MODE=mock requires UNE_AUTH_JWT_SECRET of at least 32 characters (environment secret)',
    );
  }
  const databaseUrl = env.DATABASE_URL ?? '';
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  const runtimeRole = env.UNE_DB_RUNTIME_ROLE || undefined;
  if (runtimeRole && !/^[a-z_][a-z0-9_]*$/.test(runtimeRole)) {
    throw new Error('UNE_DB_RUNTIME_ROLE must be a plain lowercase role name');
  }
  const port = intEnv(env.PORT, 3001);
  return {
    port,
    authMode,
    jwtSecret,
    accessTtlSec: intEnv(env.UNE_ACCESS_TOKEN_TTL_SEC, 900),
    refreshTtlSec: intEnv(env.UNE_REFRESH_TOKEN_TTL_SEC, 43200),
    databaseUrl,
    runtimeRole,
    publicBaseUrl: (env.UNE_PUBLIC_API_BASE_URL ?? `http://127.0.0.1:${port}`).replace(/\/+$/, ''),
    uploadMaxBytes: intEnv(env.UNE_UPLOAD_MAX_BYTES, 50 * 1024 * 1024),
    jsonMaxBytes: intEnv(env.UNE_JSON_MAX_BYTES, 1024 * 1024),
    uploadTicketTtlSec: intEnv(env.UNE_UPLOAD_TICKET_TTL_SEC, 900),
    corsAllowedOrigins: parseOrigins(env.UNE_CORS_ALLOWED_ORIGINS),
    situationMockScenarios: env.UNE_SITUATION_MOCK_SCENARIOS === 'true',
    situationProviderTimeoutMs: intEnv(env.UNE_SITUATION_PROVIDER_TIMEOUT_MS, 10_000),
    knowledgeMaxFileBytes: intEnv(env.UNE_KNOWLEDGE_MAX_FILE_BYTES, 50 * 1024 * 1024),
    knowledgeAllowedMimeTypes: parseMimeList(env.UNE_KNOWLEDGE_ALLOWED_MIME_TYPES),
    knowledgeAllowScanPending: env.UNE_KNOWLEDGE_ALLOW_SCAN_PENDING === 'true',
    knowledgeMaxUploadAttempts: intEnv(env.UNE_KNOWLEDGE_MAX_UPLOAD_ATTEMPTS, 3),
  };
}

/**
 * CORS 허용 출처 파싱.
 *
 * `*`를 거부한다. 토큰이 Authorization 헤더로 다니므로 와일드카드가 즉시
 * 자격증명 유출로 이어지지는 않지만, 허용 출처는 배포마다 아는 값이고
 * 모르는 채로 열어 두는 편의가 나중에 그대로 운영에 남는다.
 */
function parseOrigins(raw: string | undefined): readonly string[] {
  const items = (raw ?? '')
    .split(',')
    .map((v) => v.trim().replace(/\/+$/, ''))
    .filter((v) => v.length > 0);
  for (const origin of items) {
    if (origin === '*') {
      throw new Error('UNE_CORS_ALLOWED_ORIGINS must list explicit origins (no wildcard)');
    }
    if (!/^https?:\/\/[^/\s]+$/.test(origin)) {
      throw new Error(`UNE_CORS_ALLOWED_ORIGINS entry is not an origin: ${origin}`);
    }
  }
  return items;
}

/**
 * 지식문서 허용 MIME (CC-220).
 *
 * 기본값은 설계 06 US-SIT-009가 예로 든 자료(훈련계획서·매뉴얼·평가지침)의
 * 통상 형식이다. 확장자를 신뢰하지 않는다 — 최종 판정은 업로드 검증
 * (UNE-DOC-002)의 내용 검사이며 여기는 선언 단계의 1차 거름망이다.
 */
const DEFAULT_KNOWLEDGE_MIME_TYPES = [
  'application/pdf',
  'application/hwp+zip',
  'application/vnd.hancom.hwpx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
] as const;

export function parseMimeList(raw: string | undefined): ReadonlySet<string> {
  if (raw === undefined || raw.trim() === '') return new Set(DEFAULT_KNOWLEDGE_MIME_TYPES);
  const items = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  if (items.length === 0) {
    throw new Error('UNE_KNOWLEDGE_ALLOWED_MIME_TYPES가 비어 있다 — 값을 지우려면 변수를 제거하라');
  }
  if (items.includes('*') || items.includes('*/*')) {
    throw new Error('지식문서 허용 MIME에 와일드카드를 쓸 수 없다 (US-SIT-009 1단계 형식 검사)');
  }
  return new Set(items);
}
