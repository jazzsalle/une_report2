---
paths:
  - "apps/web/**/*.{ts,tsx}"
  - "apps/field-web/**/*.{ts,tsx}"
---
# Frontend Rules

- Use generated API clients and shared schemas; do not hand-copy response types.
- Treat server state separately from local editor state.
- Every async screen supports loading, empty, partial, recoverable error, terminal error, and permission states.
- Destructive or irreversible actions require explicit confirmation.
- Preserve editor selection anchors across async AI results and detect stale revisions before apply.
- Show source, observed time, collected time, confidence, and confirmation status for SituationFact.
- Do not render external provider raw payload directly.
