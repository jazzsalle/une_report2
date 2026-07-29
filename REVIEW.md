# UNE Code Review Instructions

Classify findings as BLOCKER, HIGH, MEDIUM, or LOW.

Always check:

- violation of ADR or scope boundaries
- LLM-derived facts entering SituationSnapshot, Execution Log, or locked journal cells
- plan flow calling UNI
- loss of immutable version history or append-only events
- missing tenant isolation, RBAC, audit trail, idempotency, ETag/version check, or transaction boundary
- provider payload leaking into domain/UI without adapter mapping
- HWPX unsupported object loss or direct upstream patch without Patch ID
- migration edited after application, missing FK/index/check, or unsafe destructive SQL
- secrets, personal data, tokens, URLs, or certificates committed to source
- tests that assert only HTTP 200 and omit state/error/concurrency behavior

A review is not complete until it cites the affected design/ADR/API or explains why the change is implementation-only.
