---
paths:
  - "database/**/*.sql"
  - "services/api/**/*Migration*"
---
# Database Rules

- PostgreSQL migrations are forward-only and immutable after merge.
- Every business table includes tenant isolation where applicable.
- Use UUID identifiers, timestamptz, explicit FK names, and CHECK constraints for stable state sets.
- Large files stay in object storage; the DB stores metadata and SHA-256.
- Execution and audit data are append-only. Corrections reference the original event.
- Add indexes based on documented access paths and verify query plans for high-volume queries.
