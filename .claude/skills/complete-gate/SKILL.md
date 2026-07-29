---
description: Verifies a Work Item against Definition of Done and prepares the evidence record before status changes to DONE.
---

- Check requirements, states, permissions, errors, idempotency, concurrency, audit, and security.
- Run required build, lint, unit, integration, contract, and E2E commands.
- Compare OpenAPI/Schema/DB migration with implementation.
- Launch the `qa-gate-reviewer` subagent with the Work Item ID, changed files, evidence paths, and Definition of Done checklist; it returns the PASS / PASS WITH CONDITIONS / FAIL verdict. The main session must not self-certify the gate.
- Record evidence paths and commands.
- Mark DONE only on the reviewer's PASS; otherwise use BLOCKED or PASS_WITH_CONDITIONS.
