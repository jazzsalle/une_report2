import { describe, expect, it } from 'vitest';
import { ApiError } from '../common/api-error';
import { parseSopGenerationBody } from './sop-job.service';

/**
 * UNE-SOP-001 요청 파싱 (CC-240).
 *
 * 상태 전이·선행조건은 워커 e2e와 API e2e가 DB에 대고 증명한다. 여기서 보는
 * 것은 **경계에서 계약을 어떻게 읽는가**뿐이다.
 */

const VALID = {
  snapshotId: '11111111-1111-4111-8111-111111111111',
  evidenceSetId: '22222222-2222-4222-8222-222222222222',
  schemaVersion: '1.0',
};

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
    return 'NO_ERROR';
  } catch (err) {
    return err instanceof ApiError ? err.code : 'UNKNOWN';
  }
};

describe('parseSopGenerationBody', () => {
  it('계약 필드를 내부 이름으로 옮긴다', () => {
    // 계약은 `schemaVersion`, 내부는 `graphSchemaVersion`이다 — UniSopMapper
    // 버전과 헷갈리지 않으려고 경계에서 한 번만 옮긴다.
    expect(parseSopGenerationBody(VALID)).toEqual({
      snapshotId: VALID.snapshotId,
      evidenceSetId: VALID.evidenceSetId,
      graphSchemaVersion: '1.0',
    });
  });

  it('UUID가 아니면 거절한다', () => {
    expect(codeOf(() => parseSopGenerationBody({ ...VALID, snapshotId: 'abc' }))).toBe(
      'SOP-400-001',
    );
    expect(codeOf(() => parseSopGenerationBody({ ...VALID, evidenceSetId: 42 }))).toBe(
      'SOP-400-001',
    );
  });

  it('지원하지 않는 스키마 버전을 거절한다', () => {
    // 모르는 버전을 받아 '1.0'처럼 처리하면, 클라이언트는 자기가 요청한 모양의
    // 그래프를 받았다고 믿는다.
    expect(codeOf(() => parseSopGenerationBody({ ...VALID, schemaVersion: '2.0' }))).toBe(
      'SOP-400-001',
    );
  });

  it('본문이 없으면 세 필드 모두를 위반으로 알린다', () => {
    try {
      parseSopGenerationBody(undefined);
      expect.unreachable();
    } catch (err) {
      expect(((err as ApiError).violations ?? []).map((v) => v.field)).toEqual([
        'snapshotId',
        'evidenceSetId',
        'schemaVersion',
      ]);
    }
  });
});
