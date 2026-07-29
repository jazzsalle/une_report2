---
description: Creates and verifies a safe PostgreSQL forward migration with constraints, indexes, tenant isolation, rollback/forward-fix notes, and integration tests.
---

- Confirm current migration head and whether the target migration has shipped.
- Never edit a merged/applied migration.
- Include DDL, data backfill if needed, constraint validation order, indexes, and performance impact.
- Run migration on an empty DB and an upgraded fixture DB.
- Record forward-fix and recovery procedure.
