# Implementation Changelog

## Unreleased

- CC-000 (2026-07-30): implementation profile approved. Backend NestJS
  (Node/TS) per ADR-19 (supersedes ASP.NET Core 8 recommendation), pnpm,
  MinIO/S3-compatible storage, GitHub Actions CI, Chrome+Edge latest,
  Windows 11 QA. Deployment: local Docker Compose (free path); demos need
  public URLs (no fixed IPs) → frontend Vercel + cloud container backend,
  host OPEN as OB-14. Hancom Track B version stays OPEN as OB-08.
  Reviewed by architecture-guardian and qa-gate-reviewer (parallel);
  all High/Medium findings fixed same day: IMPLEMENTATION_BASELINE §6 synced
  to approved profile, session handoff updated, demo access-control and
  mock-jwt constraints added, branch policy recorded, ADR register created,
  ADR-19 citation/supersede-scope corrected (rhwp stays Rust/WASM per ADR-15).
  Files: work-items/00_DECISIONS_TO_CONFIRM.yaml,
  docs/adr/ADR-19-backend-profile-nestjs.md, docs/adr/README.md,
  docs/handoff/TECHNOLOGY_PROFILE.md, docs/handoff/IMPLEMENTATION_BASELINE.md,
  docs/handoff/OPEN_BINDINGS.md, docs/handoff/SOURCE_OF_TRUTH.md,
  docs/handoff/SESSION_HANDOFF.md, CLAUDE.md,
  work-items/MASTER_WORK_ITEMS.yaml, work-items/IMPLEMENTATION_STATUS.md.
