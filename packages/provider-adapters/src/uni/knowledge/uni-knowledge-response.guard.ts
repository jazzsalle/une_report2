import { UNI_PROCESSING_STATUSES } from '@une/domain';
import type {
  UniEvidenceChunk,
  UniReferenceOutcome,
  UniSearchOutcome,
  UniStatusOutcome,
  UniUploadOutcome,
} from './uni-knowledge-port';

/**
 * UNI 응답 가드 (CC-220).
 *
 * 번들 스냅샷의 모든 오퍼레이션이 `additionalProperties: true`라 생성 타입은
 * 아무것도 보장하지 않는다. 설계 08 §1.9가 적은 `{message, filename, doc_id}`가
 * 기준선이고 그 밖은 OB-13이다.
 *
 * 그래서 **추측하지 않고 거부한다.** 기대한 모양이 아니면 매핑하지 않고 계약
 * 위반으로 올리며, 원문은 호출부가 통째로 보존한다. 이렇게 하지 않으면 UNI가
 * 형태를 바꿨을 때 UNE가 조용히 잘못된 값을 저장하고, 그 값이 SOP 근거까지
 * 흘러간다.
 *
 * 필드 이름은 **설정으로 바꿀 수 있다** — 사내 개발자가 실제 이름을 알려주면
 * 코드 변경 없이 맞춘다(OB-13). 기본값은 설계 08의 이름이다.
 */

export interface UniFieldNames {
  documentId: string;
  fileName: string;
  message: string;
  status: string;
  /** 검색 응답(CC-230). 전부 미확인이며 CR-UNI-008로 요청 중이다. */
  searchResults: string;
  chunkId: string;
  score: string;
  text: string;
}

export const DEFAULT_UNI_FIELD_NAMES: UniFieldNames = {
  documentId: 'doc_id',
  fileName: 'filename',
  message: 'message',
  status: 'status',
  // **CC-410 실측(2026-08-14).** `/search/` 실응답은
  // `{results:[{filename, score, text, doc_id}]}`이고 score는 0..1이다
  // (0.9594·0.9456·0.9088 관측). 감싸는 필드명 `results`도 확인됐다.
  searchResults: 'results',
  /**
   * **UNI에는 chunk id가 없다 (CC-410 실측).**
   *
   * `uni-sop-1` 시절 `'chunk_id'`를 기본값으로 두었으나 실 응답의 항목 키는
   * `filename/score/text/doc_id` 넷뿐이다. 있지도 않은 이름을 기본값으로 두면
   * 가드가 매번 못 찾고, "UNI가 안 줬다"인지 "우리가 딴 이름을 봤다"인지
   * 구분되지 않는다. 빈 문자열은 **찾지 않는다**는 뜻이다 — 근거 항목의
   * chunkId는 null이 되고, 그것이 사실이다.
   *
   * 설계 09 REG-02/03이 요구하는 page/section도 UNI 응답에 없다. 청크 단위
   * 인용을 하려면 UNI가 필드를 열어야 한다(OB-13에 유지).
   */
  chunkId: '',
  score: 'score',
  text: 'text',
};

export type GuardResult<T> = { ok: true; value: T } | { ok: false; reason: string };

function asRecord(body: unknown): Record<string, unknown> | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

function readString(rec: Record<string, unknown>, key: string): string | null {
  const v = rec[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * 업로드 응답 → `UniUploadOutcome`.
 *
 * `doc_id`만이 필수다. 그것이 없으면 우리는 이 문서를 다시 가리킬 수 없고,
 * 그러면 "등록됐다"고 적을 수 없다(0028 §3의 상관식이 같은 것을 강제한다).
 * `message`/`filename`은 있으면 남기고 없어도 통과한다 — 우리가 그것으로
 * 판단하는 것이 없다.
 */
export function guardUniUpload(
  body: unknown,
  fields: UniFieldNames = DEFAULT_UNI_FIELD_NAMES,
): GuardResult<UniUploadOutcome> {
  const rec = asRecord(body);
  if (!rec) return { ok: false, reason: '응답 본문이 JSON 객체가 아니다' };

  const documentId = readString(rec, fields.documentId);
  if (!documentId) {
    return {
      ok: false,
      reason: `업로드 응답에 문서 식별자(${fields.documentId})가 없다 — 이 문서를 다시 가리킬 수 없다`,
    };
  }

  return {
    ok: true,
    value: {
      documentId,
      fileName: readString(rec, fields.fileName),
      message: readString(rec, fields.message),
    },
  };
}

/**
 * 상태 응답 → `UniStatusOutcome`.
 *
 * 상태 문자열은 설계 08 §1.9의 어휘 안에 있어야 한다. 모르는 값을 그대로
 * 저장하면 0028 §3의 CHECK가 거부하고, 거부하지 않더라도 그 값을 읽는 코드가
 * READY 여부를 판단할 수 없다. 대소문자만 정규화한다 — 그 이상은 추측이다.
 */
export function guardUniStatus(
  body: unknown,
  documentIdFallback: string,
  fields: UniFieldNames = DEFAULT_UNI_FIELD_NAMES,
): GuardResult<UniStatusOutcome> {
  const rec = asRecord(body);
  if (!rec) return { ok: false, reason: '응답 본문이 JSON 객체가 아니다' };

  const raw = readString(rec, fields.status);
  if (!raw) return { ok: false, reason: `응답에 처리상태(${fields.status})가 없다` };

  const normalized = raw.toUpperCase();
  if (!(UNI_PROCESSING_STATUSES as readonly string[]).includes(normalized)) {
    return {
      ok: false,
      reason:
        `모르는 처리상태 "${raw}" — 설계 08 §1.9의 어휘가 아니다. ` +
        '추측해서 매핑하지 않는다(원문은 보존된다).',
    };
  }

  return {
    ok: true,
    value: {
      documentId: readString(rec, fields.documentId) ?? documentIdFallback,
      status: normalized,
    },
  };
}

/**
 * 참조요약 응답 → `UniReferenceOutcome`.
 *
 * 설계 08 §1.9가 "200 READY / 202 PROCESSING"이라고 적으므로 **준비 여부의
 * 근거는 본문이 아니라 HTTP 상태다.** 202에는 본문이 없을 수 있고 그것은
 * 오류가 아니다.
 */
export function guardUniReference(
  httpStatus: number,
  body: unknown,
  documentId: string,
): GuardResult<UniReferenceOutcome> {
  if (httpStatus === 202) {
    return { ok: true, value: { documentId, ready: false, reference: null } };
  }
  if (httpStatus !== 200) {
    return { ok: false, reason: `참조요약 응답의 상태코드가 200/202가 아니다 (${httpStatus})` };
  }
  const rec = asRecord(body);
  if (!rec) return { ok: false, reason: '참조요약 본문이 JSON 객체가 아니다' };
  return { ok: true, value: { documentId, ready: true, reference: rec } };
}

/**
 * 검색 응답 → `UniSearchOutcome` (CC-230).
 *
 * **부분 수용을 하지 않는다.** 청크 하나라도 모양이 틀리면 응답 전체를 거부한다.
 * 근거는 SOP의 출처가 되고 EvidenceSet은 동결되므로, "일부는 건너뛰고 나머지로
 * 진행했다"가 나중에 "왜 이 근거가 빠졌는가"로 돌아온다 — 그때 답할 기록이
 * 없다. 거부하면 원문은 보존되고 사용자는 다시 검색하거나 수동으로 진행한다
 * (US-SIT-011 A-01).
 *
 * 결과 0건은 **오류가 아니다** — A-01이 정상 분기로 정의한 상태다.
 */
export function guardUniSearch(
  body: unknown,
  fields: UniFieldNames = DEFAULT_UNI_FIELD_NAMES,
): GuardResult<UniSearchOutcome> {
  // 최상위가 배열인 형태와 `{results: [...]}` 형태 둘 다 흔하므로 둘 다 받는다.
  // 그 밖의 모양은 추측하지 않는다.
  let list: unknown;
  if (Array.isArray(body)) {
    list = body;
  } else {
    const rec = asRecord(body);
    if (!rec) return { ok: false, reason: '검색 응답이 JSON 객체나 배열이 아니다' };
    list = rec[fields.searchResults];
    if (list === undefined) {
      return { ok: false, reason: `검색 응답에 결과 배열(${fields.searchResults})이 없다` };
    }
  }
  if (!Array.isArray(list)) {
    return { ok: false, reason: `검색 결과(${fields.searchResults})가 배열이 아니다` };
  }

  const chunks: UniEvidenceChunk[] = [];
  for (const [i, raw] of list.entries()) {
    const rec = asRecord(raw);
    if (!rec) return { ok: false, reason: `검색 결과 ${i}번이 객체가 아니다` };

    const documentId = readString(rec, fields.documentId);
    if (!documentId) {
      // 출처를 가리키지 못하는 청크는 근거가 될 수 없다(US-SIT-011 E-02).
      return { ok: false, reason: `검색 결과 ${i}번에 문서 식별자(${fields.documentId})가 없다` };
    }
    const text = readString(rec, fields.text);
    if (!text) return { ok: false, reason: `검색 결과 ${i}번에 인용문(${fields.text})이 없다` };

    const rawScore = rec[fields.score];
    const score = typeof rawScore === 'number' && Number.isFinite(rawScore) ? rawScore : null;

    chunks.push({
      documentId,
      chunkId: readString(rec, fields.chunkId),
      fileName: readString(rec, fields.fileName),
      score,
      text,
    });
  }
  return { ok: true, value: { chunks } };
}
