import { describe, expect, it } from 'vitest';
import { ApiError } from '../common/api-error';
import { documentErrors, parseIfMatch } from './document-errors';

describe('CC-150 ETag 관용구', () => {
  it('강한 태그와 맨 숫자를 모두 받고, 약한 태그는 거부한다', () => {
    expect(parseIfMatch('"3"')).toBe(3);
    expect(parseIfMatch('3')).toBe(3);
    expect(parseIfMatch('  "12" ')).toBe(12);
    // RFC 7232는 If-Match에 강한 비교만 허용한다.
    expect(() => parseIfMatch('W/"3"')).toThrowError(ApiError);
  });

  it('부재는 428 COM-0428, 형식 오류는 400 COM-0400이다', () => {
    const missing = (() => {
      try {
        parseIfMatch(undefined);
      } catch (err) {
        return err as ApiError;
      }
      throw new Error('expected throw');
    })();
    expect(missing.status).toBe(428);
    expect(missing.code).toBe('COM-0428');

    const malformed = (() => {
      try {
        parseIfMatch('not-a-number');
      } catch (err) {
        return err as ApiError;
      }
      throw new Error('expected throw');
    })();
    expect(malformed.status).toBe(400);
    expect(malformed.code).toBe('COM-0400');
    expect(malformed.violations?.[0].field).toBe('If-Match');
  });

  it('빈 문자열과 공백은 "값 없음"이지 형식 오류가 아니다(428)', () => {
    for (const value of ['', '   ']) {
      try {
        parseIfMatch(value);
        throw new Error('expected throw');
      } catch (err) {
        expect((err as ApiError).status).toBe(428);
      }
    }
  });
});

describe('CC-150 충돌 오류의 복구 정보', () => {
  const state = {
    currentRevisionId: '3f1c1a52-2b0f-4a1e-9f2d-6c7b8a9d0e11',
    currentRevisionNo: 7,
    headIrHash: 'a'.repeat(64),
  };

  it('세 충돌 코드 모두 ETag 헤더와 meta.conflict를 싣는다', () => {
    const cases: Array<[ApiError, string]> = [
      [documentErrors.changeSetConflict(state), 'DOC-409-001'],
      [documentErrors.restoreConflict(state), 'DOC-409-002'],
      [documentErrors.autosaveConflict(state), 'DOC-409-003'],
    ];
    for (const [error, code] of cases) {
      expect(error.status).toBe(409);
      expect(error.code).toBe(code);
      expect(error.recoverable).toBe(true);
      // error는 common-error.schema.json에서 additionalProperties:false다 —
      // 복구 정보는 반드시 열려 있는 meta로 간다.
      expect(error.meta).toEqual({ conflict: state });
      expect(error.headers).toEqual({ ETag: '"7"' });
    }
  });

  it('DOC-* 코드가 공통 오류 코드 패턴을 만족한다', () => {
    // common-error.schema.json의 error.code 패턴 ^[A-Z]+-[0-9]{3,4}(-[0-9]{3})?$
    const pattern = /^[A-Z]+-[0-9]{3,4}(-[0-9]{3})?$/;
    for (const error of [
      documentErrors.revisionNotFound(),
      documentErrors.documentNotFound(),
      documentErrors.changeSetConflict(state),
      documentErrors.restoreConflict(state),
      documentErrors.autosaveConflict(state),
      documentErrors.unprocessable([]),
      documentErrors.mutationIdReused(),
      documentErrors.ifMatchRequired(),
    ]) {
      expect(error.code).toMatch(pattern);
    }
  });
});
