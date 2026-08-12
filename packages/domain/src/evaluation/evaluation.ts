import type { DashboardKpi } from '../execution/execution-log';

/**
 * 훈련 평가 (CC-310, UNE-JNL-013~015).
 *
 * 두 가지를 지킨다.
 *
 *   1. **지표는 CC-290의 산출기 하나에서 온다.** 평가가 자기 계산기를 가지면
 *      대시보드와 평가서의 숫자가 갈라지고, 갈라진 날 어느 쪽이 참인지 말할 수
 *      없다(ADR-43 D1). 여기서는 그 결과를 받아 **고정**만 한다.
 *   2. **결론에는 근거가 붙는다.** 인수기준이 "모든 평가결론 근거 연결"이다.
 *      근거로 단 이벤트가 이 훈련의 것인지는 서비스가 확인하고, 여기서는 근거
 *      없는 점수를 셀 수 있게 한다.
 */

export const EVALUATION_STATUSES = ['OPEN', 'CONFIRMED'] as const;
export type EvaluationStatus = (typeof EVALUATION_STATUSES)[number];

export function isEvaluationStatus(v: unknown): v is EvaluationStatus {
  return (EVALUATION_STATUSES as readonly unknown[]).includes(v);
}

/** 확정된 평가는 고치지 않는다. 정정은 새 평가다. */
export function isEvaluationEditable(status: string): boolean {
  return status === 'OPEN';
}

export const EVALUATION_TYPES = ['EXERCISE'] as const;
export type EvaluationType = (typeof EVALUATION_TYPES)[number];

export const IMPROVEMENT_TARGET_TYPES = ['PLAN', 'SOP', 'SYSTEM'] as const;
export type ImprovementTargetType = (typeof IMPROVEMENT_TARGET_TYPES)[number];

export function isImprovementTargetType(v: unknown): v is ImprovementTargetType {
  return (IMPROVEMENT_TARGET_TYPES as readonly unknown[]).includes(v);
}

/** `SYSTEM`은 가리킬 행이 없다. `PLAN`·`SOP`는 반드시 있어야 한다. */
export function targetNeedsId(targetType: string): boolean {
  return targetType === 'PLAN' || targetType === 'SOP';
}

// ---------------------------------------------------------------------------
// 지표
// ---------------------------------------------------------------------------

/**
 * 산출의 근거.
 *
 * 값만 저장하면 나중에 "이 숫자가 낡았는가"를 물을 수 없다. 무엇을 보고 냈는지
 * 함께 적어 둔다.
 *
 * **해시는 DB가 낸다**(`summarizeEvents`의 `md5(string_agg(...))`). 여기서 한 번 더
 * 계산하는 함수를 두면 같은 값의 구현이 둘이 되고, 둘이 갈라지는 날 드리프트
 * 판정이 조용히 틀린다. 조회마다 이벤트를 전량 적재하지 않는 이점도 함께 온다.
 */
export interface MetricBasis {
  eventCount: number;
  lastEventId: string | null;
  /** 정정 이벤트까지 포함해 접은 결과의 해시. 정정이 붙으면 값이 달라진다. */
  streamHash: string;
  computedAt: string;
}

/**
 * 고정한 지표가 낡았는가.
 *
 * **자동으로 다시 계산하지 않는다.** 평가는 사람이 확정하는 문서이고, 조회할
 * 때마다 숫자가 조용히 달라지면 무엇을 확정한 것인지 말할 수 없다. 낡았다는
 * 사실만 드러내고, 다시 내는 것은 사람의 행위다(ADR-44 D6과 같은 판단).
 */
export function isMetricStale(stored: MetricBasis, current: MetricBasis): boolean {
  return stored.streamHash !== current.streamHash;
}

export interface EvaluationMetrics {
  kpi: DashboardKpi;
  /** 완료 임무 / 센 임무. 분모가 0이면 `null`이다 — 0%가 아니다. */
  completionRate: number | null;
  /** 지연 임무 / 센 임무. 같은 규칙. */
  overdueRate: number | null;
}

/**
 * KPI에서 비율을 낸다.
 *
 * **분모가 0이면 `null`이다.** 설계 06 US-SIT-036 E-01이 "KPI 분모 0 → N/A
 * 처리·사유표시"를 요구한다. 0%로 적으면 "임무가 하나도 없었다"와 "하나도
 * 못 끝냈다"가 같은 값이 된다.
 */
export function deriveMetrics(kpi: DashboardKpi): EvaluationMetrics {
  const total = kpi.total;
  return {
    kpi,
    completionRate: total > 0 ? round2(kpi.completed / total) : null,
    overdueRate: total > 0 ? round2(kpi.overdue / total) : null,
  };
}

/** 저장 자릿수(`numeric(6,2)`)와 같은 반올림. 이름과 동작이 어긋나지 않게 한다. */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ---------------------------------------------------------------------------
// 점수
// ---------------------------------------------------------------------------

export interface ScoreInput {
  criterionCode: string;
  scoreValue: number;
  weightValue: number;
  comment: string | null;
  evidenceEventIds: readonly string[];
}

export const CRITERION_CODE_MAX_CHARS = 60;
export const SCORE_COMMENT_MAX_CHARS = 2000;

/**
 * 값의 상한 — **DB 자릿수와 같다**(`numeric(6,2)` / `numeric(6,3)`).
 *
 * 여기서 막지 않으면 큰 수가 22003으로 떨어져 500이 된다. 척도를 넘긴 것은
 * 사용자의 입력 문제이므로 422여야 한다.
 */
export const SCORE_VALUE_MAX = 9999.99;
export const WEIGHT_VALUE_MAX = 999.999;

export interface ScoreViolation {
  criterionCode: string;
  reason: string;
}

/**
 * 점수의 형태를 본다.
 *
 * 척도(0~100인지 1~5인지)는 여기서 정하지 않는다 — 정본은 평가 루브릭이고
 * 지표마다 다르다. 대신 **셀 수 없는 값**과 **근거 없는 결론**을 막는다.
 */
export function validateScores(scores: readonly ScoreInput[]): ScoreViolation[] {
  const out: ScoreViolation[] = [];
  const seen = new Set<string>();

  for (const score of scores) {
    const code = score.criterionCode.trim();
    if (code.length === 0 || code.length > CRITERION_CODE_MAX_CHARS) {
      out.push({ criterionCode: score.criterionCode, reason: '지표 코드가 비었거나 너무 깁니다.' });
      continue;
    }
    if (seen.has(code)) {
      out.push({ criterionCode: code, reason: '같은 지표를 두 번 적었습니다.' });
      continue;
    }
    seen.add(code);

    if (!Number.isFinite(score.scoreValue) || Math.abs(score.scoreValue) > SCORE_VALUE_MAX) {
      out.push({
        criterionCode: code,
        reason: `점수는 ±${SCORE_VALUE_MAX} 안의 수여야 합니다.`,
      });
    }
    if (
      !Number.isFinite(score.weightValue) ||
      score.weightValue < 0 ||
      score.weightValue > WEIGHT_VALUE_MAX
    ) {
      out.push({
        criterionCode: code,
        reason: `가중치는 0 이상 ${WEIGHT_VALUE_MAX} 이하여야 합니다.`,
      });
    }
    if ((score.comment?.length ?? 0) > SCORE_COMMENT_MAX_CHARS) {
      out.push({ criterionCode: code, reason: '의견이 너무 깁니다.' });
    }
  }
  return out;
}

/**
 * 근거 없는 결론을 센다.
 *
 * 막지는 않는다 — 정성 평가는 이벤트로 뒷받침되지 않을 수 있고(A-01
 * "정성평가+자료부족 명시"), 근거 없는 점수를 금지하면 평가자가 아무 이벤트나
 * 붙이게 된다. 대신 **몇 개가 근거 없이 매겨졌는지 보고서가 말한다.**
 */
export function scoresWithoutEvidence(scores: readonly ScoreInput[]): string[] {
  return scores.filter((s) => s.evidenceEventIds.length === 0).map((s) => s.criterionCode.trim());
}

/**
 * 종합 점수 — 가중 평균.
 *
 * 가중치 합이 0이면 `null`이다. 0으로 나눈 값을 0점으로 적으면 "평가하지
 * 않았다"와 "0점이다"가 같아진다.
 */
export function overallScore(scores: readonly ScoreInput[]): number | null {
  const weightSum = scores.reduce((sum, s) => sum + s.weightValue, 0);
  if (weightSum <= 0) return null;
  const weighted = scores.reduce((sum, s) => sum + s.scoreValue * s.weightValue, 0);
  return round2(weighted / weightSum);
}

// ---------------------------------------------------------------------------
// 보고서
// ---------------------------------------------------------------------------

/**
 * 만족도.
 *
 * **수집 경로가 없다.** 설계 §3.9의 API 넷 어디에도 설문을 제출하는 연산이
 * 없고, `survey_response` 테이블은 §6에 정의조차 없다. 응답을 만들 코드가 없는
 * 테이블을 만드는 것은 "언젠가 온다"는 거짓 약속이다(0022 §1).
 *
 * 그래서 **부재를 1급 값으로** 적는다. 빈 배열이나 `null`로 두면 "설문을 했는데
 * 응답이 0건"과 구분되지 않는다 — 보고서를 읽는 사람이 만족도가 낮다고 읽을 수
 * 있다. 설계 06 A-01의 `LIMITED_EVAL`("정성평가+자료부족 명시")이 이 자리다.
 */
export const SATISFACTION_STATUSES = ['NOT_COLLECTED'] as const;
export type SatisfactionStatus = (typeof SATISFACTION_STATUSES)[number];

export interface SatisfactionSection {
  status: SatisfactionStatus;
  reason: string;
  responseCount: number;
}

export function satisfactionSection(): SatisfactionSection {
  return {
    status: 'NOT_COLLECTED',
    reason:
      '만족도 설문을 수집하는 경로가 아직 없습니다. 활용성·잠재가치 의견은 평가 종합의견과 지표 의견에 정성으로 적혀 있습니다.',
    responseCount: 0,
  };
}

/** 보고서 형식. 실제로 나오는 것만 적는다 — HWPX·PDF는 이 항목에 없다. */
export const EVALUATION_REPORT_FORMATS = ['JSON'] as const;
export type EvaluationReportFormat = (typeof EVALUATION_REPORT_FORMATS)[number];
