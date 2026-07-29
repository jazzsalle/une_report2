# PostgreSQL Migrations

- Forward-only. 적용된 마이그레이션은 절대 수정하지 않는다 (수정은 새 forward 마이그레이션).
- `V001`~`V010`은 설계 기준선에서 인계된 초기 스키마다 (57-table baseline, RLS, 파티셔닝 계획 포함).
- 실제 적용·검증과 마이그레이션 도구 선정(node-pg-migrate vs Prisma migrate)은 **CC-004**에서 수행한다 (ADR-19 유예 항목).
- 새 마이그레이션은 V011부터 이어서 추가한다.
