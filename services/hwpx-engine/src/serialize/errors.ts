/**
 * 저장/Export 경로 오류 (CC-160, ADR-31).
 *
 * 설계 §1.4의 검사코드표는 **반입** 코드(HWPX-1001~1005)만 정의한다. 저장
 * 경로는 실패 양상이 다르므로(쓸 수 없는 엔트리, 원본에 없는 Part, 앵커 소실,
 * 저장 차단) 1100번대를 새로 연다. 반입 코드를 재사용하지 않는 이유는,
 * 같은 코드가 "업로드 거부"와 "저장 실패" 두 뜻을 가지면 감사 로그에서
 * 어느 경로의 사고인지 구분할 수 없기 때문이다.
 */

export const HWPX_EXPORT_ERROR_CODES = [
  'HWPX-1101', // 재작성할 수 없는 ZIP 엔트리(암호화·data descriptor·한도 초과)
  'HWPX-1102', // 보존 저장이 허용하지 않는 패키지 구조 변경(Part 신설·삭제)
  'HWPX-1103', // 편집 결과를 원본 XML에 되쓸 수 없음(앵커 소실·힌트 부재)
  'HWPX-1104', // 호환성 등급에 의한 저장 차단(ADR-29 D11)
  'HWPX-1105', // Track A 검증 실패로 산출물 폐기
] as const;

export type HwpxExportErrorCode = (typeof HWPX_EXPORT_ERROR_CODES)[number];

export class HwpxExportError extends Error {
  readonly code: HwpxExportErrorCode;
  readonly locator: string;
  readonly detail: string;

  constructor(code: HwpxExportErrorCode, locator: string, detail: string) {
    super(`${code} ${locator}: ${detail}`);
    this.name = 'HwpxExportError';
    this.code = code;
    this.locator = locator;
    this.detail = detail;
  }
}
