/** SituationFact 정규화 (CC-200 인수기준 3 "normalization").
 *
 * 정본은 **설계 06 US-SIT-006**이다. 그 시나리오가 정규화의 결과를 세 갈래로
 * 나눠 두었고, 이 파일은 그 셋을 판별 유니온으로 옮긴 것이다.
 *
 *   #1 필드·단위·시각·지역을 canonical 형식으로 변환한다 (변환버전 기록)
 *                                                        → NORMALIZED
 *   A-01 단위 변환 불가 → **원문값 유지** + NEEDS_REVIEW  → ORIGINAL_KEPT
 *   E-01 필수 category/value 누락 → 후보 격리             → INVALID
 *   E-02 시각 파싱 실패 → 후보 격리·원문 보기 제공        → INVALID
 *
 * 두 가지를 지킨다.
 *
 * **원문은 어떤 경우에도 버리지 않는다.** 세 결과 모두 `raw`를 들고 나온다.
 * 설계 06 US-SIT-006의 완료조건이 "원천 provenance 손실 0건, 자동삭제 0건"이고,
 * 격리(INVALID)조차 "후보 격리·원문 보기 제공"이지 폐기가 아니다.
 *
 * **정규화는 값을 바꾸지 판정을 하지 않는다.** confidence를 계산하거나 후보를
 * 채택/기각하지 않는다 — 그것은 사용자 확인(CC-210)의 몫이고, LLM이든
 * 정규화기든 자동으로 사실을 확정할 수 없다는 CLAUDE.md 규칙과 같은 선이다.
 */

import { FACT_KEY_PATTERN, findFactKeySpec, isFactType, type FactType } from './fact-vocabulary';

/** 변환버전(설계 06 US-SIT-006 #1 "변환버전 기록"). 변환표가 바뀌면 올린다 —
 * 저장된 Fact가 어떤 규칙으로 만들어졌는지 사후에 답할 수 있어야 한다. */
export const FACT_NORMALIZATION_VERSION = '1.0.0';

export const NORMALIZATION_OUTCOMES = ['NORMALIZED', 'ORIGINAL_KEPT', 'INVALID'] as const;
export type NormalizationOutcome = (typeof NORMALIZATION_OUTCOMES)[number];

/** 격리 사유(E-01/E-02)와 검토 사유(A-01). 화면과 provider_job.error_json이
 * 같은 어휘를 쓴다. */
export const NORMALIZATION_REASONS = [
  'FACT_TYPE_MISSING',
  'FACT_TYPE_UNKNOWN',
  'FACT_KEY_MISSING',
  'FACT_KEY_MALFORMED',
  'VALUE_MISSING',
  'VALUE_KIND_MISMATCH',
  'TIME_UNPARSABLE',
  'TIME_OFFSET_MISSING',
  'UNIT_UNCONVERTIBLE',
  'UNIT_UNEXPECTED',
  'UNIT_MISSING',
] as const;
export type NormalizationReason = (typeof NORMALIZATION_REASONS)[number];

/** 어댑터가 넘기는 정규화 전 항목. Provider별 DTO는 어댑터 안에만 있고
 * (architecture.md) 여기 오는 것은 이미 그 경계를 지난 중립 형태다. */
export interface RawFactItem {
  factType?: unknown;
  factKey?: unknown;
  value?: unknown;
  unit?: unknown;
  observedAt?: unknown;
  /** Provider 원문 그대로. 정규화가 손대지 않고 결과에 실어 보낸다. */
  raw?: unknown;
}

export interface NormalizedValue {
  value: unknown;
  unit: string | null;
}

export interface NormalizationNote {
  reason: NormalizationReason;
  detail: string;
}

interface NormalizationBase {
  raw: unknown;
  notes: NormalizationNote[];
  normalizationVersion: string;
}

export interface NormalizedFact extends NormalizationBase {
  outcome: 'NORMALIZED' | 'ORIGINAL_KEPT';
  factType: FactType;
  factKey: string;
  value: unknown;
  unit: string | null;
  /** 정규화 전 값·단위. A-01(원문값 유지)이 이 자리를 쓴다. */
  originalValue: unknown;
  originalUnit: string | null;
  observedAt: string | null;
}

export interface InvalidFact extends NormalizationBase {
  outcome: 'INVALID';
}

export type NormalizationResult = NormalizedFact | InvalidFact;

export function isNormalized(result: NormalizationResult): result is NormalizedFact {
  return result.outcome !== 'INVALID';
}

// ── 단위 ────────────────────────────────────────────────────────────────────

/** 같은 단위의 다른 표기를 하나로 모은다. 대소문자와 도 기호 변형이 실제
 * Provider 응답에서 섞여 온다. */
const UNIT_ALIASES: Readonly<Record<string, string>> = {
  '°c': 'degC',
  '℃': 'degC',
  c: 'degC',
  degc: 'degC',
  celsius: 'degC',
  '°f': 'degF',
  '℉': 'degF',
  f: 'degF',
  degf: 'degF',
  fahrenheit: 'degF',
  k: 'K',
  kelvin: 'K',
  mm: 'mm',
  cm: 'cm',
  m: 'm',
  'm/s': 'm/s',
  mps: 'm/s',
  'km/h': 'km/h',
  kmh: 'km/h',
  kph: 'km/h',
  kt: 'kt',
  knot: 'kt',
  knots: 'kt',
  '%': '%',
  percent: '%',
  hpa: 'hPa',
  mb: 'hPa',
  millibar: 'hPa',
};

export function canonicalUnitToken(unit: string): string | null {
  const key = unit.trim().toLowerCase();
  if (key.length === 0) return null;
  return UNIT_ALIASES[key] ?? null;
}

/** from → to 변환 계수/식. 표에 없는 쌍은 변환 불가(A-01)다. */
const CONVERSIONS: ReadonlyMap<string, (value: number) => number> = new Map([
  ['degC>degC', (v: number) => v],
  ['degF>degC', (v: number) => ((v - 32) * 5) / 9],
  ['K>degC', (v: number) => v - 273.15],
  ['mm>mm', (v: number) => v],
  ['cm>mm', (v: number) => v * 10],
  ['m>mm', (v: number) => v * 1000],
  ['m>m', (v: number) => v],
  ['cm>m', (v: number) => v / 100],
  ['m/s>m/s', (v: number) => v],
  ['km/h>m/s', (v: number) => v / 3.6],
  ['kt>m/s', (v: number) => v * 0.514444],
  ['%>%', (v: number) => v],
  ['hPa>hPa', (v: number) => v],
]);

/** 부동소수 잔재를 자른다. (77-32)*5/9 = 25.000000000000004 같은 값이 그대로
 * 저장되면 같은 사실이 Provider마다 다른 문자열로 남는다. */
function roundValue(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function convertUnit(
  value: number,
  from: string,
  to: string,
): { ok: true; value: number } | { ok: false } {
  const fn = CONVERSIONS.get(`${from}>${to}`);
  if (!fn) return { ok: false };
  const converted = fn(value);
  if (!Number.isFinite(converted)) return { ok: false };
  return { ok: true, value: roundValue(converted) };
}

// ── 시각 ────────────────────────────────────────────────────────────────────

/** 명시적 오프셋(또는 Z)을 요구한다.
 *
 * 오프셋 없는 `2026-08-08T09:00:00`은 KST일 수도 UTC일 수도 있고, 어느 쪽으로
 * 추측해도 9시간 어긋난 사실이 감사에 남는다. backend.md가 "ISO-8601 with
 * explicit offset"을 요구하는 자리이고, 설계 06 E-02가 파싱 실패를 폐기가
 * 아니라 **격리**로 처리하라고 정해 두었으므로 추측하지 않고 격리한다. */
const ISO_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

function daysInMonth(year: number, month: number): number {
  // month는 1..12. 0일을 요청하면 Date가 전달 말일을 준다.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function normalizeTimestamp(
  input: string,
): { ok: true; value: string } | { ok: false; reason: NormalizationReason } {
  const text = input.trim();
  const match = ISO_WITH_OFFSET.exec(text);
  if (!match) {
    // 형태가 ISO인데 오프셋만 없는 경우와, 아예 못 읽는 경우를 구분해 알려준다.
    const naive = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(text);
    return { ok: false, reason: naive ? 'TIME_OFFSET_MISSING' : 'TIME_UNPARSABLE' };
  }

  // 구성요소를 직접 검사한다. `new Date`에만 맡기면 2026-02-30이 3월 2일로
  // **굴러가** 존재하지 않는 관측시각이 조용히 사실로 저장된다(실측).
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  if (month < 1 || month > 12) return { ok: false, reason: 'TIME_UNPARSABLE' };
  if (day < 1 || day > daysInMonth(year, month)) return { ok: false, reason: 'TIME_UNPARSABLE' };
  // 윤초(:60)는 받지 않는다 — timestamptz가 표현하지 못한다.
  if (hour > 23 || minute > 59 || second > 59) return { ok: false, reason: 'TIME_UNPARSABLE' };

  const offset = match[8] as string;
  if (offset !== 'Z') {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(-2));
    // UTC 오프셋의 실제 범위는 -12:00~+14:00이다.
    if (offsetHour > 14 || offsetMinute > 59) return { ok: false, reason: 'TIME_UNPARSABLE' };
  }

  const parsed = new Date(text.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return { ok: false, reason: 'TIME_UNPARSABLE' };
  return { ok: true, value: parsed.toISOString() };
}

// ── 값 ──────────────────────────────────────────────────────────────────────

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (text.length === 0) return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && !value.trim());
}

// ── 정규화 ──────────────────────────────────────────────────────────────────

function invalid(raw: unknown, reason: NormalizationReason, detail: string): InvalidFact {
  return {
    outcome: 'INVALID',
    raw,
    notes: [{ reason, detail }],
    normalizationVersion: FACT_NORMALIZATION_VERSION,
  };
}

/**
 * 한 원문 항목을 canonical Fact 후보로 옮긴다.
 *
 * 카탈로그에 없는 Key는 거부하지 않는다 — 설계 §20.5는 "대표 필드"이고
 * FIELD_REPORT/USER_ASSERTED는 열린 어휘다. 다만 단위 정규화의 근거가 없으므로
 * 단위는 원문 그대로 두고 결과를 ORIGINAL_KEPT로 낮춘다(A-01과 같은 취급).
 */
export function normalizeFact(item: RawFactItem): NormalizationResult {
  const raw = item.raw !== undefined ? item.raw : { ...item };

  if (isMissing(item.factType)) {
    return invalid(raw, 'FACT_TYPE_MISSING', 'factType이 없습니다.');
  }
  if (!isFactType(item.factType)) {
    return invalid(raw, 'FACT_TYPE_UNKNOWN', `알 수 없는 factType입니다: ${String(item.factType)}`);
  }
  if (isMissing(item.factKey)) {
    return invalid(raw, 'FACT_KEY_MISSING', 'factKey가 없습니다.');
  }
  const factKey = String(item.factKey).trim();
  if (!FACT_KEY_PATTERN.test(factKey)) {
    return invalid(
      raw,
      'FACT_KEY_MALFORMED',
      `factKey가 표준 표기(${String(FACT_KEY_PATTERN.source)})를 만족하지 않습니다: ${factKey}`,
    );
  }
  if (item.value === undefined || item.value === null) {
    return invalid(raw, 'VALUE_MISSING', 'value가 없습니다.');
  }

  let observedAt: string | null = null;
  if (!isMissing(item.observedAt)) {
    if (typeof item.observedAt !== 'string') {
      return invalid(raw, 'TIME_UNPARSABLE', 'observedAt이 문자열이 아닙니다.');
    }
    const time = normalizeTimestamp(item.observedAt);
    if (!time.ok) {
      return invalid(raw, time.reason, `observedAt을 읽을 수 없습니다: ${item.observedAt}`);
    }
    observedAt = time.value;
  }

  const originalUnit = typeof item.unit === 'string' && item.unit.trim() ? item.unit.trim() : null;
  const notes: NormalizationNote[] = [];
  // (범주, Key) 쌍으로 찾는다. 같은 이름이라도 범주가 다르면 다른 사실이다.
  const spec = findFactKeySpec(factKey, item.factType);

  let value: unknown = item.value;
  let unit: string | null = originalUnit;
  let outcome: 'NORMALIZED' | 'ORIGINAL_KEPT' = 'NORMALIZED';

  if (!spec) {
    // 카탈로그 밖의 Key — 변환 근거가 없으므로 원문 보존.
    outcome = 'ORIGINAL_KEPT';
    notes.push({
      reason: 'UNIT_UNCONVERTIBLE',
      detail: `${item.factType}의 표준 Key 카탈로그에 없는 Key입니다(${factKey}). 값과 단위를 원문대로 보존합니다.`,
    });
  } else if (spec.valueKind === 'number') {
    const numeric = coerceNumber(item.value);
    if (numeric === null) {
      return invalid(raw, 'VALUE_KIND_MISMATCH', `${factKey}는 수치여야 합니다.`);
    }
    if (spec.unit === null) {
      value = roundValue(numeric);
    } else if (originalUnit === null) {
      // 단위를 **추측하지 않는다.**
      //
      // 처음에는 "없으면 canonical로 온 것"으로 보고 `unit = spec.unit`을 채운
      // 뒤 결과를 NORMALIZED로 냈다. 그러면 화씨 77을 넣은 사용자에게 화면이
      // "정규화 성공, 77 degC"를 보여주고 검토 신호가 하나도 없다. 이것은
      // D9(오프셋 없는 시각은 추측하지 않고 격리한다)와 정확히 반대이고,
      // 정보가 **더 적은** 경우(단위 미상)를 정보가 더 많은 경우
      // (변환 불가 → ORIGINAL_KEPT)보다 높게 판정하는 뒤집힘이었다
      // (아키텍처 리뷰 M-6, ADR-33 D18).
      //
      // 값은 수치로 정리하되 단위는 비워 두고 검토 대상으로 내린다.
      outcome = 'ORIGINAL_KEPT';
      value = roundValue(numeric);
      unit = null;
      notes.push({
        reason: 'UNIT_MISSING',
        detail: `${factKey}의 표준 단위는 ${spec.unit}인데 단위가 오지 않았습니다. 단위를 확인하십시오.`,
      });
    } else {
      const token = canonicalUnitToken(originalUnit);
      const converted = token ? convertUnit(numeric, token, spec.unit) : { ok: false as const };
      if (converted.ok) {
        value = converted.value;
        unit = spec.unit;
      } else {
        // A-01: 변환 불가 — 원문값·원문단위를 그대로 두고 검토 대상으로 표시.
        outcome = 'ORIGINAL_KEPT';
        value = numeric;
        unit = originalUnit;
        notes.push({
          reason: 'UNIT_UNCONVERTIBLE',
          detail: `${originalUnit} → ${spec.unit} 변환 규칙이 없습니다. 원문값을 보존합니다.`,
        });
      }
    }
  } else if (spec.valueKind === 'string') {
    if (typeof item.value !== 'string') {
      return invalid(raw, 'VALUE_KIND_MISMATCH', `${factKey}는 문자열이어야 합니다.`);
    }
    value = item.value.trim();
    if (originalUnit !== null) {
      outcome = 'ORIGINAL_KEPT';
      notes.push({
        reason: 'UNIT_UNEXPECTED',
        detail: `${factKey}에는 단위가 없어야 하는데 ${originalUnit}이 왔습니다.`,
      });
    }
  } else {
    // valueKind === 'object' — 배열도 여기 해당한다(null은 위에서 걸렀다).
    if (typeof item.value !== 'object') {
      return invalid(raw, 'VALUE_KIND_MISMATCH', `${factKey}는 객체 또는 배열이어야 합니다.`);
    }
    value = item.value;
  }

  return {
    outcome,
    factType: item.factType,
    factKey,
    value,
    unit,
    originalValue: item.value,
    originalUnit,
    observedAt,
    raw,
    notes,
    normalizationVersion: FACT_NORMALIZATION_VERSION,
  };
}

/** 여러 항목을 한 번에. 통과분과 격리분을 나눠 돌려준다 —
 * `provider_job`의 상관식(0023 §4 `ck_provider_job_outcome_shape`)이
 * "통과 건수"와 "탈락 사유"를 동시에 요구하기 때문에 호출부가 둘 다 필요하다. */
export interface NormalizationBatch {
  normalized: NormalizedFact[];
  invalid: InvalidFact[];
}

export function normalizeFacts(items: readonly RawFactItem[]): NormalizationBatch {
  const normalized: NormalizedFact[] = [];
  const rejected: InvalidFact[] = [];
  for (const item of items) {
    const result = normalizeFact(item);
    if (isNormalized(result)) normalized.push(result);
    else rejected.push(result);
  }
  return { normalized, invalid: rejected };
}
