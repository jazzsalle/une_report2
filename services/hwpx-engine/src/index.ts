/**
 * `@une/hwpx-engine` 공개 표면 (CC-140).
 *
 * 소비자는 CC-150의 API/워커다. IR **타입**은 `@une/domain`에서 가져가고
 * (ADR-29 D4), 여기서는 그 타입을 **만드는 절차**만 내보낸다.
 */

// 계약과 엔진 구현
export * from './contract';

// AC2 — 패키지 분석
export * from './package/errors';
export * from './package/limits';
export * from './package/zip-reader';
export * from './package/xml';
export * from './package/opc-package';
export * from './package/package-analysis';

// AC3 — Document IR
export * from './ir/anchors';
export * from './ir/stable-id';
export * from './ir/header-index';
export * from './ir/ir-builder';
export * from './ir/invariants';
export * from './ir/reference-check';

// AC4 — 호환성 분류
export * from './compat/object-rules';
export * from './compat/classifier';

// 템플릿 분석기
export * from './analysis/style-signature';
export * from './analysis/outline-pattern';
export * from './analysis/static-region';
export * from './analysis/prototype-registry';
export * from './analysis/confidence';
export * from './analysis/template-analyzer';
export * from './analysis/template-profile';

// CC-150 — 편집층(IR v2, Selection, ChangeSet, 역연산)
export * from './edit/ir-lift';
export * from './edit/authored-id';
export * from './edit/document-tree';
export * from './edit/selection-resolver';
export * from './edit/prototype-resolve';
export * from './edit/inverse-ops';
export * from './edit/change-set-executor';
export * from './edit/edit-invariants';

// 반입 상태 신고
export * from './intake/rhwp-status';

// 테스트 지원(합성 픽스처·코퍼스 로더). 운영 경로에서 호출하지 않는다.
export * from './testing/synth-hwpx';
export * from './testing/corpus';
