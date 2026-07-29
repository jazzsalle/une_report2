# OPEN External Bindings

These items must not be guessed by Claude Code.

| ID | Binding | Current fallback | Completion evidence |
|---|---|---|---|
| OB-01 | T3Q auth, base URL, TLS, timeout, rate limit, error schema | mock adapter | signed interface sheet + contract test |
| OB-02 | T3Q current disaster situation API | SituationProviderPort disabled adapter | approved API contract |
| OB-03 | T3Q RPT-003 use for journal | UNE JournalProjection is owner | ADR amendment if enabled |
| OB-04 | UNI compns actual fields and SopGraph mapping | versioned mapper + raw payload retention | mapping table + test payloads |
| OB-05 | SafeKorea/Naver legal and operational approval | feature flag off | policy/legal approval |
| OB-06 | real SMS/email/messenger/broadcast contracts | simulation/system channels | channel interface contract |
| OB-07 | validation institutions and natural/social scenarios | reference scenario packs | institution binding record |
| OB-08 | Hancom version for Track B (Windows QA env fixed to Windows 11 at CC-000) | Track A only | Track B test report |
| OB-10 | T3Q plan API CR-T3Q-001/002/003/004/009 acceptance | legacy RPT-001/002 + target-v2 mock adapter | signed change response + dev contract tests |
| OB-11 | T3Q evidence search and semantic validation CR-T3Q-005/006 | UNE UI placeholder + mock response | accepted contract + representative payloads |
| OB-12 | ProcessGPT adoption and rhwp pinned source decisions | ProcessGPT evaluation-only; rhwp not imported until provenance gate | ADR + license/SBOM/hash/POC report |
| OB-13 | UNI live base path, auth, TLS, limits, and error contract | bundled OpenAPI snapshot + mock adapter | live OpenAPI capture + contract tests |
| OB-14 | demo backend host (Render/Railway/Fly candidate) and final delivery environment | local Docker Compose; frontend demo on Vercel | host decision recorded before first G2 demo; delivery env binding record |

## Closed bindings

| ID | Binding | Closed by | Evidence |
|---|---|---|---|
| OB-09 | repository URL, backend profile, CI, deployment target | CC-000 approval 2026-07-30 | `work-items/00_DECISIONS_TO_CONFIRM.yaml` (APPROVED), ADR-19; residual deployment items moved to OB-14 |
