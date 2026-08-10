import { DEFAULT_UNI_SOP_FIELDS, HttpUniSopAdapter } from './http-uni-sop-adapter';
import { MockUniSopAdapter } from './mock-uni-sop-adapter';
import type { UniSopProvider } from './uni-sop-port';

/**
 * UNI SOP 어댑터 선택 (CC-240).
 *
 * 지식문서 팩토리(CC-220)와 같은 규칙이다:
 *   mock (기본)  MockUniSopAdapter — UNE 상태기계·매퍼 검증용
 *   http         HttpUniSopAdapter — 실 호출, provider 미검증
 *
 * 운영에서 mock을 쓰면 기동하지 않는다. mock 결과를 UNI 지원으로 보고하지
 * 않기 위한 장치이며 그 판단을 배포 설정에 맡기지 않는다.
 */

export const UNI_SOP_ADAPTERS = ['mock', 'http'] as const;
export type UniSopAdapterId = (typeof UNI_SOP_ADAPTERS)[number];

export interface UniSopFactoryEnv {
  UNE_UNI_SOP_ADAPTER?: string;
  UNE_UNI_BASE_URL?: string;
  UNE_UNI_SOP_FIRST_EVENT_TIMEOUT_MS?: string;
  UNE_UNI_SOP_TOTAL_TIMEOUT_MS?: string;
  UNE_UNI_SOP_FIELD_QUERY?: string;
  UNE_UNI_SOP_FIELD_DOC_IDS?: string;
  UNE_UNI_MOCK_SCENARIOS?: string;
  UNE_ALLOW_MOCK_PROVIDER?: string;
  NODE_ENV?: string;
}

function intFrom(v: string | undefined, fallback: number): number {
  if (v === undefined || v.trim() === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`정수(양수)여야 한다: ${v}`);
  return n;
}

export function createUniSopProvider(env: UniSopFactoryEnv): UniSopProvider {
  const id = (env.UNE_UNI_SOP_ADAPTER ?? 'mock').trim() as UniSopAdapterId;
  if (!(UNI_SOP_ADAPTERS as readonly string[]).includes(id)) {
    throw new Error(`UNE_UNI_SOP_ADAPTER는 ${UNI_SOP_ADAPTERS.join('|')} 중 하나여야 한다: ${id}`);
  }

  if (id === 'mock') {
    if (env.NODE_ENV === 'production' && env.UNE_ALLOW_MOCK_PROVIDER !== 'true') {
      throw new Error(
        'production에서 UNI SOP mock 어댑터를 쓸 수 없다. 승인된 데모라면 ' +
          'UNE_ALLOW_MOCK_PROVIDER=true를 명시하라 — mock은 UNI 지원이 아니다.',
      );
    }
    return new MockUniSopAdapter({ scenariosEnabled: env.UNE_UNI_MOCK_SCENARIOS === 'true' });
  }

  const baseUrl = (env.UNE_UNI_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(baseUrl)) {
    throw new Error(
      `UNE_UNI_BASE_URL이 http(s) URL이어야 한다: ${baseUrl || '(없음)'} — ` +
        'UNI 실 어댑터는 어떤 값도 추측하지 않는다(OB-04/OB-13).',
    );
  }

  return new HttpUniSopAdapter({
    baseUrl,
    // 설계 08 §1.14: 첫 이벤트 30초, 전체 5분.
    firstEventTimeoutMs: intFrom(env.UNE_UNI_SOP_FIRST_EVENT_TIMEOUT_MS, 30_000),
    totalTimeoutMs: intFrom(env.UNE_UNI_SOP_TOTAL_TIMEOUT_MS, 300_000),
    // 요청 필드명은 계약이 없다 — 설정으로 열어둔다(OB-04).
    queryField: env.UNE_UNI_SOP_FIELD_QUERY?.trim() || DEFAULT_UNI_SOP_FIELDS.queryField,
    documentIdsField:
      env.UNE_UNI_SOP_FIELD_DOC_IDS?.trim() || DEFAULT_UNI_SOP_FIELDS.documentIdsField,
  });
}
