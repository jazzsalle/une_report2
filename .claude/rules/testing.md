---
paths:
  - "tests/**"
  - "**/*.test.*"
  - "**/*Tests.*"
---
# Testing Rules

- Tests cover normal, alternate, exception, permission, state conflict, duplicate/idempotent, and concurrency paths.
- Contract tests validate examples against OpenAPI and JSON Schema.
- Integration tests use a real PostgreSQL instance or Testcontainers, not only mocks.
- E2E evidence must prove the two vertical slices: Plan and Situation-SOP-Journal.
- HWPX tests retain input, output, validation report, and comparison evidence.
