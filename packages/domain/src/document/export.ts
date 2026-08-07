import type { DocumentCompatibilityVerdict } from './compatibility';

/**
 * Export/저장·Track A 검증 어휘 (CC-160, ADR-31).
 *
 * 이 파일이 정본인 이유는 ADR-29 D4와 같다: 어휘가 엔진·API·워커·DB CHECK
 * 네 곳에 흩어지면 서로 다른 값을 허용하게 되고, 그 어긋남은 런타임에만
 * 드러난다. 엔진은 이 상수를 **소비**하고, 마이그레이션 CHECK는 이 목록에서
 * 유도한 것과 같아야 한다(계약 테스트가 대조한다).
 */

/** 설계 07 §1.10 저장 모드표. `AUTOSAVE_IR`은 CC-150이 이미 구현했다. */
export const SAVE_MODES = ['SAVE_AS', 'SAVE_REVISION', 'EXPORT_COPY', 'AUTOSAVE_IR'] as const;
export type SaveMode = (typeof SAVE_MODES)[number];

/** HWPX 바이트를 실제로 만드는 모드 — `AUTOSAVE_IR`은 패키지를 만들지 않는다. */
export const PACKAGE_PRODUCING_SAVE_MODES: ReadonlySet<SaveMode> = new Set<SaveMode>([
  'SAVE_AS',
  'SAVE_REVISION',
  'EXPORT_COPY',
]);

/** export_job.format — 설계 10 §6 'HWPX/PDF/DOCX'. */
export const EXPORT_FORMATS = ['HWPX', 'PDF', 'DOCX'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/**
 * CC-160이 실제로 산출할 수 있는 형식은 HWPX뿐이다. PDF/DOCX는 어휘에는
 * 있지만 변환기가 없다 — 요청되면 거부하고, "지원한다"고 광고하지 않는다.
 */
export const IMPLEMENTED_EXPORT_FORMATS: ReadonlySet<ExportFormat> = new Set<ExportFormat>([
  'HWPX',
]);

/**
 * export_job.status — 설계 10 §6은 'QUEUED~FAILED'로만 적었다. 생성 Job
 * (`JOB_STATUSES`, CC-120)과 같은 이름을 쓰되 취소 경로는 두지 않는다:
 * Export는 사용자 취소 API가 계약에 없고(UNE-DOC-012~014), 취소 상태를
 * 만들어 두면 도달 불가능한 상태가 DB에 남는다.
 */
export const EXPORT_STATUSES = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

export const TERMINAL_EXPORT_STATUSES: ReadonlySet<ExportStatus> = new Set<ExportStatus>([
  'COMPLETED',
  'FAILED',
]);

const EXPORT_TRANSITIONS: Record<ExportStatus, readonly ExportStatus[]> = {
  QUEUED: ['RUNNING', 'FAILED'],
  RUNNING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
};

export function canTransitionExport(from: ExportStatus, to: ExportStatus): boolean {
  return EXPORT_TRANSITIONS[from].includes(to);
}

/** validation_report.track — 설계 10 §6 'A_AUTO/B_HANCOM'. */
export const VALIDATION_TRACKS = ['A_AUTO', 'B_HANCOM'] as const;
export type ValidationTrack = (typeof VALIDATION_TRACKS)[number];

/** validation_report.status — 설계 10 §6 'PASS/LIMITED/FAIL'. */
export const VALIDATION_STATUSES = ['PASS', 'LIMITED', 'FAIL'] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

/** validation_report.target_type — 0018이 CC-160으로 미룬 어휘. */
export const VALIDATION_TARGET_TYPES = ['DOCUMENT', 'EXPORT'] as const;
export type ValidationTargetType = (typeof VALIDATION_TARGET_TYPES)[number];

/**
 * 설계 07 §1.11 검증계층표 7종을 그대로 쓴다. Track A가 자동으로 도는 것은
 * 앞의 넷뿐이고 VISUAL/HANCOM/EDIT은 런타임 요청 경로가 아니다:
 *   - VISUAL은 rhwp 렌더가 필요하다(미반입, OB-12).
 *   - HANCOM은 Track B이며 릴리스 게이트다(CLAUDE.md, OB-08).
 *   - EDIT은 E2E 시나리오(CC-170)이지 저장 시 검사가 아니다.
 * 계층을 지우지 않고 남기는 이유는, 빠진 계층이 "검사했는데 통과"로 보이지
 * 않도록 보고서에 NOT_RUN 사유와 함께 실어야 하기 때문이다.
 */
export const VALIDATION_LAYERS = [
  'PACKAGE',
  'REFERENCE',
  'SEMANTIC',
  'STYLE',
  'VISUAL',
  'HANCOM',
  'EDIT',
] as const;
export type ValidationLayer = (typeof VALIDATION_LAYERS)[number];

/** Track A가 저장 요청 경로에서 실제로 실행하는 계층. */
export const TRACK_A_LAYERS: readonly ValidationLayer[] = [
  'PACKAGE',
  'REFERENCE',
  'SEMANTIC',
  'STYLE',
];

/**
 * 실행하지 않는 계층과 그 사유. 보고서는 미실행을 침묵하지 않는다 —
 * "검사 안 함"과 "검사해서 통과"를 같은 모양으로 두면 증거가 거짓말한다.
 */
export const LAYER_NOT_RUN_REASONS: Readonly<Partial<Record<ValidationLayer, string>>> = {
  VISUAL: 'rhwp Core 미반입 — 렌더 비교 불가 (OB-12)',
  HANCOM: 'Track B는 릴리스 게이트이며 런타임 요청 경로가 아니다 (OB-08)',
  EDIT: '편집 E2E는 저장 시 검사가 아니라 시나리오 게이트다 (CC-170)',
};

/**
 * Track A 검사코드.
 *
 * 설계에는 §1.4 반입 검사코드표(HWPX-1001~1005)만 있고 **저장 검증 코드표는
 * 없다.** 없는 것을 있는 척하지 않고 여기서 새로 정의하며, 그 사실과 근거를
 * ADR-31에 기록한다. 코드는 `RTA-<계층>-<번호>`로 계층을 이름에 실어
 * 보고서만 보고도 어느 계층이 깨졌는지 알 수 있게 한다.
 */
export const TRACK_A_CHECKS = [
  // PACKAGE — ZIP/mimetype/manifest/관계/XML well-formed (§1.11 Package 행)
  'RTA-PKG-001', // 산출물이 ZIP으로 다시 읽힌다
  'RTA-PKG-002', // mimetype 엔트리가 첫 엔트리이고 STORED이며 값이 정확하다
  'RTA-PKG-003', // 필수 Part(version/container/content.hpf/header/section) 존재
  'RTA-PKG-004', // content.hpf manifest 항목이 실제 엔트리와 일치한다
  'RTA-PKG-005', // 모든 XML Part가 well-formed로 다시 파싱된다
  'RTA-PKG-006', // 원본 엔트리 집합·순서가 유지된다(추가·삭제·재배열 없음)
  'RTA-PKG-007', // 되쓰지 않은 Part는 저장 바이트까지 동일하다
  // REFERENCE — paraPr/charPr/style/numbering/binData (§1.11 Reference 행)
  'RTA-REF-001', // dangling 스타일/번호 참조 0
  'RTA-REF-002', // binData 참조가 실제 Part를 가리킨다
  'RTA-REF-003', // 새로 발급한 ID가 문서 전체에서 유일하다(§1.10-2)
  // SEMANTIC — 문단·표·텍스트·필드·개요 (§1.11 Semantic 행)
  'RTA-SEM-001', // 편집 의도 외 문단 수 변화 없음
  'RTA-SEM-002', // 편집 의도 외 텍스트 손실 없음
  'RTA-SEM-003', // 표 구조(행·열·병합) 보존
  'RTA-SEM-004', // 미지원/보존 객체가 바이트 단위로 남아 있다(AC3)
  // STYLE — 글꼴·크기·장평·간격·들여쓰기·번호 (§1.11 Style 행)
  'RTA-STY-001', // 문단 스타일 참조가 Prototype 기준과 일치
  'RTA-STY-002', // 개요 수준·기호 앞 공백이 원문 그대로 유지
] as const;
export type TrackACheckCode = (typeof TRACK_A_CHECKS)[number];

export const TRACK_A_CHECK_LAYER: Readonly<Record<TrackACheckCode, ValidationLayer>> = {
  'RTA-PKG-001': 'PACKAGE',
  'RTA-PKG-002': 'PACKAGE',
  'RTA-PKG-003': 'PACKAGE',
  'RTA-PKG-004': 'PACKAGE',
  'RTA-PKG-005': 'PACKAGE',
  'RTA-PKG-006': 'PACKAGE',
  'RTA-PKG-007': 'PACKAGE',
  'RTA-REF-001': 'REFERENCE',
  'RTA-REF-002': 'REFERENCE',
  'RTA-REF-003': 'REFERENCE',
  'RTA-SEM-001': 'SEMANTIC',
  'RTA-SEM-002': 'SEMANTIC',
  'RTA-SEM-003': 'SEMANTIC',
  'RTA-SEM-004': 'SEMANTIC',
  'RTA-STY-001': 'STYLE',
  'RTA-STY-002': 'STYLE',
};

export const CHECK_OUTCOMES = ['PASS', 'WARN', 'FAIL', 'NOT_RUN'] as const;
export type CheckOutcome = (typeof CHECK_OUTCOMES)[number];

export interface TrackACheckResult {
  readonly code: TrackACheckCode;
  readonly layer: ValidationLayer;
  readonly outcome: CheckOutcome;
  /** 사람이 읽는 근거. 실패면 무엇이 어긋났는지 구체적으로 적는다. */
  readonly detail: string;
  /** 실패 위치(Part 경로·앵커·ID). 없으면 문서 전체. */
  readonly locator?: string;
}

/**
 * 계층 롤업: FAIL이 하나라도 있으면 FAIL, WARN만 있으면 LIMITED, 나머지 PASS.
 *
 * NOT_RUN은 **상태를 낮추지 않는다** — 미실행 계층(VISUAL/HANCOM/EDIT)은
 * 애초에 이 트랙의 책임이 아니고, 낮추면 모든 Track A 보고서가 영원히
 * LIMITED가 되어 등급이 정보를 잃는다. 대신 보고서에 사유가 남는다.
 */
export function rollUpValidationStatus(results: readonly TrackACheckResult[]): ValidationStatus {
  if (results.some((r) => r.outcome === 'FAIL')) return 'FAIL';
  if (results.some((r) => r.outcome === 'WARN')) return 'LIMITED';
  return 'PASS';
}

/**
 * 저장 차단 집행 (ADR-29 D11 / 설계 03 §8.4·§8.7).
 *
 * `REJECT` 문서는 애초에 편집 대상이 아니고, `FLATTEN_EXPORT_ONLY` 객체를
 * 가진 문서는 **원본 형식으로 되저장하면 안 된다** — 평탄화 사본만 내보낼 수
 * 있다. 지금 평탄화 변환기는 없으므로 거부가 유일하게 정직한 응답이다.
 */
export interface SaveBlockDecision {
  readonly blocked: boolean;
  readonly reason?: string;
}

export function decideSaveBlock(input: {
  readonly verdict: DocumentCompatibilityVerdict;
  readonly hasFlattenExportOnlyObject: boolean;
  readonly mode: SaveMode;
}): SaveBlockDecision {
  if (!PACKAGE_PRODUCING_SAVE_MODES.has(input.mode)) return { blocked: false };
  if (input.verdict === 'REJECT') {
    return { blocked: true, reason: 'REJECT 판정 문서는 HWPX로 저장할 수 없습니다' };
  }
  if (input.hasFlattenExportOnlyObject) {
    // EXPORT_COPY도 막는다. 설계상 이 등급은 "평탄화 사본만 허용"인데 평탄화
    // 변환기가 없다. 변환 없이 EXPORT_COPY를 열면 평탄화되지 않은 원본 객체가
    // 그대로 나가면서 §8.4 금지를 어기고, 이름만 사본인 산출물이 "평탄화됨"
    // 으로 오인된다. 변환기가 생기는 시점에 이 분기를 연다.
    return {
      blocked: true,
      reason: 'FLATTEN_EXPORT_ONLY 객체가 있어 원본 형식 저장이 금지됩니다 (평탄화 변환기 미구현)',
    };
  }
  return { blocked: false };
}
