# Review a Change

현재 diff를 ADR, Implementation Baseline, OpenAPI/Schema, DB Migration, 화면·Sequence, Definition of Done과 비교하라.

BLOCKER/HIGH/MEDIUM/LOW로 분류하고 다음을 점검하라.

- 역할 경계와 사실원장 위반
- tenant/RBAC/audit/idempotency/concurrency/transaction 누락
- provider 원본 Schema 누출
- HWPX 보존·검증 회귀
- migration 안전성
- 테스트 사각지대
- secret/PII 노출

각 발견사항에 파일·라인, 위반 근거, 수정안을 제시하라.
