/**
 * 오류 표현 (설계 09 화면·상태·권한·오류 처리표, CC-170).
 *
 * 서버는 안정된 코드와 한국어 메시지를 함께 준다(common-error.schema.json).
 * 그래서 화면은 메시지를 **다시 쓰지 않는다** — 두 벌이 되면 반드시 갈라지고,
 * 사용자는 서버 로그와 다른 문장을 보게 된다. 화면이 더하는 것은 두 가지다:
 * 코드별 "다음에 할 일", 그리고 재시도 가능 여부.
 */

export interface ApiFailure {
  status: number;
  code: string;
  message: string;
  recoverable: boolean;
  userAction?: string;
  violations?: { field: string; reason: string }[];
  correlationId?: string;
}

export class ApiCallError extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(failure.message);
    this.name = 'ApiCallError';
    this.failure = failure;
  }
}

/**
 * 코드별 다음 행동. 서버가 `userAction`을 주면 그것을 쓰고, 없을 때만 이 표를
 * 본다 — 서버가 상황을 더 잘 알기 때문이다.
 */
const NEXT_ACTION: Record<string, string> = {
  'COM-0400': '입력값을 확인한 뒤 다시 시도하십시오.',
  'COM-0403': '이 작업에 필요한 권한이 없습니다. 관리자에게 요청하십시오.',
  'COM-0409': '현재 상태를 다시 조회한 뒤 이어서 진행하십시오.',
  'COM-0428': '최신 상태를 조회해 If-Match 값을 받아 다시 시도하십시오.',
  'AUTH-1005': '다시 로그인하십시오.',
  'FILE-403-001': '업로드를 처음부터 다시 시작하십시오.',
  'FILE-409-001': '이미 확정된 파일입니다. 새로 등록하십시오.',
  'FILE-413-001': '파일이 사전등록한 크기와 다릅니다. 다시 등록하십시오.',
  'FILE-422-001': '지원하는 HWPX 파일인지, 크기 상한을 넘지 않는지 확인하십시오.',
  'FILE-422-002': '파일이 손상되었을 수 있습니다. 다시 업로드하십시오.',
  'HWPX-422-001': '업로드 검증을 통과한 HWPX 파일인지 확인하십시오.',
  'HWPX-404-001': '분석이 완료된 문서인지 확인하십시오.',
  'EXPORT-410-001': 'Export를 다시 요청해 새 산출물을 받으십시오.',
  'EXPORT-422-001': '현재 산출할 수 있는 형식은 HWPX뿐입니다.',
  'PLAN-4003': '계획서 목록에서 다시 선택하십시오.',
};

export function nextActionFor(failure: ApiFailure): string | undefined {
  return failure.userAction ?? NEXT_ACTION[failure.code];
}

/** 사용자에게 보여줄 한 줄. 코드를 함께 남기는 이유는 문의 시 대조하기 위해서다. */
export function describeFailure(failure: ApiFailure): string {
  return `${failure.message} (${failure.code})`;
}
