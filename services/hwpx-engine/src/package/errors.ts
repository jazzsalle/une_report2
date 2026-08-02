import type { HwpxFinding, HwpxFindingCode, HwpxFindingSeverity } from '@une/domain';

/**
 * 반입 오류와 finding (설계 07 §1.4 검사코드표).
 *
 * 코드 유니온(`HwpxFindingCode`)과 finding 모양은 `@une/domain`이 정본이다
 * (ADR-29 D4). 여기서는 재정의하지 않고 소비만 한다.
 *
 * 치명/비치명의 분기는 §1.4-6 그대로다:
 *   - HWPX-1001/1002 → 업로드 거부(throw). IR을 만들 대상 자체가 아니다.
 *   - HWPX-1003/1005 → FATAL finding으로 수집 후 문서 판정 REJECT(롤업 규칙 2).
 *   - HWPX-1004 → DEGRADING finding으로 수집, 판정 상한 LIMITED.
 * 즉 "던지는 오류"와 "모아서 판정하는 finding"을 층으로 분리한다. 후자는
 * 사용자에게 "왜 REJECT인지"를 전부 보여줘야 하므로 첫 오류에서 멈추지 않는다.
 */
export class HwpxImportError extends Error {
  readonly code: HwpxFindingCode;
  readonly locator: string;
  readonly detail: string;

  constructor(code: HwpxFindingCode, locator: string, detail: string) {
    super(`${code} ${locator}: ${detail}`);
    this.name = 'HwpxImportError';
    this.code = code;
    this.locator = locator;
    this.detail = detail;
  }

  toFinding(): HwpxFinding {
    return { code: this.code, severity: 'FATAL', locator: this.locator, detail: this.detail };
  }
}

export function finding(
  code: HwpxFindingCode,
  severity: HwpxFindingSeverity,
  locator: string,
  detail: string,
): HwpxFinding {
  return { code, severity, locator, detail };
}

/** 정렬된 finding 목록 — 같은 입력이면 같은 순서여야 증거가 재현된다. */
export function sortFindings(findings: readonly HwpxFinding[]): HwpxFinding[] {
  return [...findings].sort(
    (a, b) =>
      a.code.localeCompare(b.code) ||
      a.locator.localeCompare(b.locator) ||
      a.detail.localeCompare(b.detail),
  );
}
