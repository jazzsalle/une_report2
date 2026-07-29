---
paths:
  - "services/api/**"
  - "services/worker/**"
  - "packages/domain/**"
---
# Backend Rules

- Validate request schema, tenant, role, aggregate state, version/ETag, and idempotency in that order.
- Use RFC-style stable application error codes defined in the design.
- External calls run outside long database transactions.
- State change, audit/execution event, and outbox insert are atomic where defined.
- Store UTC/timestamptz and return ISO-8601 with explicit offset.
- Never log access tokens, full provider payloads containing personal data, or document contents at INFO level.
