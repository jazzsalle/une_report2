# E2E 시험 시나리오 기준선

## E2E-PLAN-001

- 목적: 임의 HWPX 업로드 -> Template Profile 분석 -> 기준정보 Snapshot -> T3Q RPT-001/002 -> rhwp 편집 -> HWPX Export
- 선행조건: 기준 데이터와 역할 Binding 완료
- 합격기준: 상태·API·DB·감사·오류 복구 결과가 상세설계와 일치
- 필수증거: Request/Response, DB Query, 화면 캡처, Correlation ID, ValidationReport

## E2E-PLAN-002

- 목적: 본문 생성 중 중지 -> 부분결과 보존 -> 실패 Block 재시도 -> 사용자 수정 Block 보호
- 선행조건: 기준 데이터와 역할 Binding 완료
- 합격기준: 상태·API·DB·감사·오류 복구 결과가 상세설계와 일치
- 필수증거: Request/Response, DB Query, 화면 캡처, Correlation ID, ValidationReport

## E2E-HWPX-001

- 목적: 원본 HWPX 무수정 저장 -> 한컴 열기/저장/재열기 -> rhwp 재열기
- 선행조건: 기준 데이터와 역할 Binding 완료
- 합격기준: 상태·API·DB·감사·오류 복구 결과가 상세설계와 일치
- 필수증거: Request/Response, DB Query, 화면 캡처, Correlation ID, ValidationReport

## E2E-SIT-001

- 목적: 공식 Provider 후보 Fact -> 중복/충돌해결 -> 불변 SituationSnapshot
- 선행조건: 기준 데이터와 역할 Binding 완료
- 합격기준: 상태·API·DB·감사·오류 복구 결과가 상세설계와 일치
- 필수증거: Request/Response, DB Query, 화면 캡처, Correlation ID, ValidationReport

## E2E-UNI-001

- 목적: 훈련자료 업로드 -> UNI 학습 -> 검색 -> chat/json SSE -> UniSopMapper
- 선행조건: 기준 데이터와 역할 Binding 완료
- 합격기준: 상태·API·DB·감사·오류 복구 결과가 상세설계와 일치
- 필수증거: Request/Response, DB Query, 화면 캡처, Correlation ID, ValidationReport

## E2E-SOP-001

- 목적: SOP Canvas 편집 -> DAG 검증 -> 승인 -> Dry-run
- 선행조건: 기준 데이터와 역할 Binding 완료
- 합격기준: 상태·API·DB·감사·오류 복구 결과가 상세설계와 일치
- 필수증거: Request/Response, DB Query, 화면 캡처, Correlation ID, ValidationReport

## E2E-TASK-001

- 목적: 임무 전파 -> 수신확인 -> 착수 -> 진행보고 -> 완료 -> 승인/반려
- 선행조건: 기준 데이터와 역할 Binding 완료
- 합격기준: 상태·API·DB·감사·오류 복구 결과가 상세설계와 일치
- 필수증거: Request/Response, DB Query, 화면 캡처, Correlation ID, ValidationReport

## E2E-OUTBOX-001

- 목적: 외부 채널 장애 -> Retry/Backoff -> Dead Letter -> 관리자 수동 재처리
- 선행조건: 기준 데이터와 역할 Binding 완료
- 합격기준: 상태·API·DB·감사·오류 복구 결과가 상세설계와 일치
- 필수증거: Request/Response, DB Query, 화면 캡처, Correlation ID, ValidationReport

## E2E-JNL-001

- 목적: Execution Log + Snapshot -> 상황일지 Projection -> 사실값 잠금 -> AI 서술 Diff
- 선행조건: 기준 데이터와 역할 Binding 완료
- 합격기준: 상태·API·DB·감사·오류 복구 결과가 상세설계와 일치
- 필수증거: Request/Response, DB Query, 화면 캡처, Correlation ID, ValidationReport

## E2E-SEC-001

- 목적: 기관 A 사용자가 기관 B의 Plan/Situation/Task 접근 시 403 및 감사로그
- 선행조건: 기준 데이터와 역할 Binding 완료
- 합격기준: 상태·API·DB·감사·오류 복구 결과가 상세설계와 일치
- 필수증거: Request/Response, DB Query, 화면 캡처, Correlation ID, ValidationReport

