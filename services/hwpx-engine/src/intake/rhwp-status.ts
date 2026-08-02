/**
 * rhwp 반입 상태 신고 (ADR-29 D1, OB-12).
 *
 * **rhwp 소스는 아직 반입되지 않았다.** CC-140은 반입 게이트만 만들고 실반입은
 * CC-145로 분리되어 있다. 그런데 엔진 패키지가 존재하고 분석이 동작하면
 * "rhwp가 들어왔다"고 오독하기 쉽다(CC-135에서 같은 종류의 오독이 있었다).
 * 그래서 엔진이 스스로 상태를 상수로 신고한다.
 *
 * 여기서는 `third_party/rhwp/PROVENANCE*`를 **읽지 않는다**. 파일 존재 여부로
 * 상태를 추론하면 다른 갈래가 그 파일을 만드는 순간 "반입됨"으로 뒤집힌다.
 * 상태 전환은 파일이 아니라 **명시적 코드 변경**으로만 일어나야 한다.
 */

export type RhwpIntakeStatus = 'RHWP_NOT_IMPORTED' | 'RHWP_IMPORTED';

export interface RhwpIntakeReport {
  readonly status: RhwpIntakeStatus;
  /** 이 상태에서 엔진이 실제로 할 수 있는 일. */
  readonly capabilities: readonly string[];
  /** 이 상태에서 할 수 없는 일 — 보고서에 그대로 옮겨 적을 수 있게 문장으로. */
  readonly limitations: readonly string[];
  readonly nextWorkItem: string;
  readonly reference: string;
}

const REPORT: RhwpIntakeReport = Object.freeze({
  status: 'RHWP_NOT_IMPORTED',
  capabilities: Object.freeze([
    'HWPX 패키지 구조 분석(ZIP/OPC 교차검증, 한도·경로 방어)',
    'Document IR 생성과 불변식 I1~I7 검사',
    '객체 호환성 분류와 문서 판정 롤업',
    'TemplateAnalyzer(스타일 시그니처·개요 패턴·정적영역·Prototype)',
  ]),
  limitations: Object.freeze([
    'rhwp Rust/WASM Core 미반입 — 렌더링·레이아웃·편집 정확도 검증은 전무하다',
    'HWPX 직렬화(저장)는 CC-160 소유이며 이 패키지에서 거부된다',
    '한컴 열기-저장-재열기(Track B)는 릴리스 게이트이지 런타임 경로가 아니다',
  ]),
  nextWorkItem: 'CC-145 (rhwp 실반입: 아카이브 SHA-256/라이선스/SBOM/패치 매니페스트)',
  reference: 'ADR-29 D1, docs/external-dependencies/RHWP_SOURCE_INTAKE.md, OB-12',
});

export function describeRhwpIntake(): RhwpIntakeReport {
  return REPORT;
}
