import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * API 전송 라우트용 업로드 티켓 (CC-170, ADR-32).
 *
 * presign을 할 수 없는 저장소 드라이버(로컬·테스트의 인메모리)에서 클라이언트는
 * API 자신의 `PUT /files/{fileId}/content`로 바이트를 보낸다. 그 라우트는
 * presign URL과 같은 성질이어야 한다: **Bearer 토큰 없이**, 오직 발급받은
 * 값만으로 인가된다. 그래야 화면 코드가 드라이버에 따라 갈라지지 않는다.
 *
 * 상태를 남기지 않는다. 티켓 테이블을 만들면 만료 청소라는 새 일이 생기는데,
 * 서명이 검증 가능한 값을 다 담고 있으므로 얻는 것이 없다. 담는 것은 넷이다:
 * fileId(어느 파일인지), tenantId(누구의 것인지 — 이것 없이는 전송 라우트가
 * 테넌트 격리를 할 수 없다), 만료, 그리고 선언 크기(상한 집행).
 *
 * 키는 JWT 서명 키에서 **라벨로 파생한다**. 같은 비밀을 두 프로토콜에 그대로
 * 쓰면 한쪽의 서명이 다른 쪽에서 의미를 갖는 혼동 공격 여지가 생긴다.
 */

const VERSION = 'v1';
const KEY_LABEL = 'une:upload-ticket:v1';

export interface UploadTicketClaims {
  readonly fileId: string;
  readonly tenantId: string;
  /** epoch seconds */
  readonly expiresAt: number;
  readonly sizeBytes: number;
}

/**
 * 서명 키 최소 길이. `jwt-auth.guard.ts`가 빈 비밀을 "키가 아니다"로 취급하는
 * 것과 같은 규칙이다 — AUTH_MODE가 mock이 아니면 `loadApiConfig`가 빈 문자열을
 * 정상 값으로 돌려주므로, 여기서 막지 않으면 **공개 상수로 파생한 키**로 쓰기를
 * 인가하게 된다(리뷰 M-2).
 */
const MIN_SECRET_LENGTH = 32;

function deriveKey(jwtSecret: string): Buffer {
  return createHmac('sha256', jwtSecret).update(KEY_LABEL).digest();
}

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function payloadOf(claims: UploadTicketClaims): string {
  // 구분자를 값에 나타날 수 없는 문자로 둔다(UUID·정수뿐이므로 '.'은 안전하다).
  return [VERSION, claims.fileId, claims.tenantId, claims.expiresAt, claims.sizeBytes].join('.');
}

export function signUploadTicket(jwtSecret: string, claims: UploadTicketClaims): string {
  if (jwtSecret.length < MIN_SECRET_LENGTH) {
    throw new Error('업로드 티켓 서명 키가 없습니다 (UNE_AUTH_JWT_SECRET 미설정)');
  }
  const payload = payloadOf(claims);
  const signature = createHmac('sha256', deriveKey(jwtSecret)).update(payload).digest();
  return `${payload}.${base64url(signature)}`;
}

/**
 * 티켓 검증. 실패 이유를 구분하지 않는다 — 위조와 만료를 다르게 답하면
 * 공격자에게 서명 검증 결과를 알려 준다. 호출자는 둘 다 403으로 답한다.
 */
export function verifyUploadTicket(
  jwtSecret: string,
  token: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): UploadTicketClaims | null {
  if (jwtSecret.length < MIN_SECRET_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 6) return null;
  const [version, fileId, tenantId, expiresAt, sizeBytes, signature] = parts;
  if (version !== VERSION) return null;

  const claims: UploadTicketClaims = {
    fileId,
    tenantId,
    expiresAt: Number(expiresAt),
    sizeBytes: Number(sizeBytes),
  };
  if (!Number.isInteger(claims.expiresAt) || !Number.isInteger(claims.sizeBytes)) return null;

  const expected = base64url(
    createHmac('sha256', deriveKey(jwtSecret)).update(payloadOf(claims)).digest(),
  );
  const provided = Buffer.from(signature, 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  if (provided.length !== wanted.length) return null;
  if (!timingSafeEqual(provided, wanted)) return null;
  if (claims.expiresAt <= nowSeconds) return null;
  return claims;
}
