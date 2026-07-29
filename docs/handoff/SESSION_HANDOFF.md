# Session Handoff

- Date/time: 2026-07-30
- Branch: main
- Current Work Item: CC-000
- Status: DONE

## Completed this session

- CC-000: implementation profile approved (NestJS/Node-TS per ADR-19, pnpm,
  MinIO/S3-compatible, GitHub Actions, Chrome+Edge latest, Windows 11 QA,
  trunk-based branch policy).
- architecture-guardian + qa-gate-reviewer parallel review completed; all
  High/Medium findings fixed (baseline sync, session handoff, demo access
  control, branch policy), Low findings applied (ADR register, ADR-19
  citation/scope fixes, rhwp Rust/WASM wording).

## Files changed

- work-items/00_DECISIONS_TO_CONFIRM.yaml (APPROVED, branch_policy, demo access-control constraints)
- docs/adr/ADR-19-backend-profile-nestjs.md, docs/adr/README.md (new)
- docs/handoff/TECHNOLOGY_PROFILE.md, IMPLEMENTATION_BASELINE.md §6, SOURCE_OF_TRUTH.md, OPEN_BINDINGS.md
- CLAUDE.md (Read first + Implementation profile)
- work-items/MASTER_WORK_ITEMS.yaml, IMPLEMENTATION_STATUS.md, CHANGELOG.md

## Tests and evidence

- python scripts/validate_handoff.py: PASS (461 files) — run by qa-gate-reviewer
- YAML parse check on decision/work-item/parallel-plan files: OK
- Secret scan on changed files: no findings

## Decisions and OPEN bindings

- ADR-19: backend NestJS supersedes ASP.NET Core 8 recommendation
- OB-09 closed; OB-14 added (demo backend host + final delivery env, decide before first G2 demo)
- OB-08 kept (Hancom Track B version, decide before G4)
- Data access/migration tool deferred to CC-004 (node-pg-migrate vs Prisma migrate)

## Risks/blockers

- .claude/settings.json still allows dotnet/npm, no pnpm entries — user must
  update permissions before CC-001 to avoid prompts (agents must not edit it).
- manifest/SHA256SUMS.txt hash for 00_DECISIONS_TO_CONFIRM.yaml is stale
  (validation script does not check hashes; informational).
- CC-000 outputs not yet committed/pushed.

## Exact next action

- Commit and push CC-000 outputs, then start CC-001 (NestJS + pnpm monorepo
  bootstrap via bootstrap-repository skill). CI/HWPX images must include the
  Rust+wasm toolchain for pinned rhwp (ADR-15/ADR-19).

## Notes

- `templete/` holds 6 real HWPX templates (보고 양식, 상황보고 등) provided by
  the user — use these as actual import/analysis/round-trip inputs for HWPX
  work items (CC-140, CC-160, hwpx-roundtrip), not synthetic fixtures.
- .claude/settings.json permissions updated 2026-07-30: dotnet removed, pnpm
  build/test/lint/typecheck/install/run added (user-approved).
