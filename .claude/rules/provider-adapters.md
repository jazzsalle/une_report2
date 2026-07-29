---
paths:
  - "packages/provider-adapters/**"
  - "services/worker/**/*Provider*"
  - "contracts/openapi/*t3q*"
---
# Provider Adapter Rules

- Keep raw request/response, adapter schema version, correlation ID, and provider timing for traceability.
- Validate provider responses before mapping to domain objects.
- Apply timeout, retry, backoff, circuit breaker, and rate-limit policies by operation.
- Do not disable TLS verification in production. Use trusted development certificates.
- T3Q and UNI fields not present in approved/live contracts are OPEN, not guessed.
- Plan flow uses `T3qPlanProvider` only and has no automatic UNI fallback.
- `LegacyT3qPlanAdapter` implements current RPT-001/002 behavior.
- `TargetV2T3qPlanAdapter` implements the requested v2 contract and may run against mock until T3Q acceptance.
- Record capability state per feature as MOCK_ONLY, UNE_ADAPTER_READY, T3Q_DEV_VERIFIED, or T3Q_PROD_VERIFIED.
- T3Q returns semantic outline/content/evidence/edit proposals; UNE owns HWPX formatting, revisions, ChangeSets, protected blocks, and final serialization.
- Do not block Plan vertical-slice POC while target-v2 fields are pending; use contract mocks and explicit feature flags.
