---
name: t3q-contract-binding
description: Implement or bind T3Q plan-generation contracts without confusing mock and actual provider support.
---
# T3Q contract binding workflow

1. Read both the legacy v0.8.5 adapter contract and target-v2 request contract.
2. Read the T3Q request DOCX and OPEN_BINDINGS.
3. State which capability state is being changed: MOCK_ONLY, UNE_ADAPTER_READY, T3Q_DEV_VERIFIED, or T3Q_PROD_VERIFIED.
4. Update `T3qPlanProvider`, the affected adapter, OpenAPI mapping, raw-payload retention, and contract tests together.
5. Never add UNI fallback to plan flow.
6. Verify protected blocks, idempotency, revision conflicts, SSE reconnect, cancel/retry, evidence provenance, and standard errors.
7. Record actual provider payload evidence before advancing to DEV/PROD_VERIFIED.
