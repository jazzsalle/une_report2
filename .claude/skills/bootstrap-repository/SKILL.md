---
description: Bootstraps the approved UNE monorepo structure and local development infrastructure after CC-000 technology decisions are confirmed. Use for CC-001 and CC-002 only.
---

1. Read `work-items/00_DECISIONS_TO_CONFIRM.yaml` and stop if required decisions remain OPEN.
2. Present the exact directories, generated files, build tools, and commands before editing.
3. Create the smallest executable skeleton for web, API, worker, HWPX engine, contracts, database, and tests.
4. Add non-secret `.env.example` files and Docker Compose for local dependencies.
5. Run build, lint/typecheck, tests, and `scripts/validate-handoff.sh`.
6. Update implementation status with commands and results.
