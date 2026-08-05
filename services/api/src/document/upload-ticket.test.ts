import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signUploadTicket, verifyUploadTicket, type UploadTicketClaims } from './upload-ticket';

/**
 * CC-170 업로드 티켓.
 *
 * 이 값은 **Bearer 토큰 없이** 쓰기를 인가한다. 그래서 검사할 것은 "정상적으로
 * 왕복하는가"가 아니라 "무엇이 통과하지 못하는가"다.
 */

const SECRET = 'upload-ticket-secret-upload-ticket-secret';
const CLAIMS: UploadTicketClaims = {
  fileId: '4d7f1a90-2b3c-4d5e-8f60-718293a4b5c6',
  tenantId: '1c9f2e30-4a5b-4c6d-8e7f-90a1b2c3d4e5',
  expiresAt: 2_000_000_000,
  sizeBytes: 33_940,
};

describe('업로드 티켓 서명·검증', () => {
  it('서명한 claim이 그대로 돌아온다', () => {
    const token = signUploadTicket(SECRET, CLAIMS);
    expect(verifyUploadTicket(SECRET, token, CLAIMS.expiresAt - 1)).toEqual(CLAIMS);
  });

  it('같은 입력은 같은 토큰이다 (재발급이 예측 가능하다)', () => {
    expect(signUploadTicket(SECRET, CLAIMS)).toBe(signUploadTicket(SECRET, CLAIMS));
  });

  it('다른 비밀로 만든 토큰은 통과하지 못한다', () => {
    const token = signUploadTicket(`${SECRET}-other`, CLAIMS);
    expect(verifyUploadTicket(SECRET, token, CLAIMS.expiresAt - 1)).toBeNull();
  });

  it('claim을 하나라도 고치면 서명이 깨진다', () => {
    const token = signUploadTicket(SECRET, CLAIMS);
    const [version, fileId, tenantId, expiresAt, sizeBytes, signature] = token.split('.');
    const tampered = [
      [version, fileId, tenantId, expiresAt, '999999999', signature],
      [version, fileId, '00000000-0000-4000-8000-000000000000', expiresAt, sizeBytes, signature],
      [version, '00000000-0000-4000-8000-000000000000', tenantId, expiresAt, sizeBytes, signature],
      // 만료를 미래로 미는 것이 공격자에게 가장 쓸모 있는 변조다.
      [version, fileId, tenantId, '4000000000', sizeBytes, signature],
    ];
    for (const parts of tampered) {
      expect(verifyUploadTicket(SECRET, parts.join('.'), CLAIMS.expiresAt - 1)).toBeNull();
    }
  });

  it('만료된 티켓은 서명이 유효해도 거부된다', () => {
    const token = signUploadTicket(SECRET, CLAIMS);
    expect(verifyUploadTicket(SECRET, token, CLAIMS.expiresAt)).toBeNull();
    expect(verifyUploadTicket(SECRET, token, CLAIMS.expiresAt + 1)).toBeNull();
  });

  it('형식이 아닌 문자열은 예외 없이 null이다', () => {
    for (const bad of ['', 'x', 'v1.a.b.c.d', `v2.${CLAIMS.fileId}.t.1.2.sig`, 'a.b.c.d.e.f']) {
      expect(verifyUploadTicket(SECRET, bad, 1)).toBeNull();
    }
  });

  it('정수가 아닌 만료·크기는 거부된다', () => {
    const token = signUploadTicket(SECRET, CLAIMS);
    const parts = token.split('.');
    parts[3] = 'NaN';
    expect(verifyUploadTicket(SECRET, parts.join('.'), 1)).toBeNull();
  });

  it('JWT 서명 키를 그대로 쓰지 않는다 (라벨로 파생한다)', () => {
    // 파생을 하지 않으면 같은 비밀·같은 payload로 만든 HMAC이 그대로 티켓
    // 서명과 같아진다. 그 성질이 없어야 두 프로토콜이 서로의 서명을 재사용할 수
    // 없다.
    const token = signUploadTicket(SECRET, CLAIMS);
    const signature = token.split('.')[5];
    const naive = createNaiveHmac(SECRET, token.split('.').slice(0, 5).join('.'));
    expect(signature).not.toBe(naive);
  });
});

/** 비교용 계산. 파생 없이 비밀을 그대로 쓴 HMAC이 어떤 값인지 보여 준다. */
function createNaiveHmac(secret: string, payload: string): string {
  return createHmac('sha256', secret)
    .update(payload)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
