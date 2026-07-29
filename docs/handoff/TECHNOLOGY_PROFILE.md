# Technology Profile - Approved at CC-000 (2026-07-30)

Approved via `work-items/00_DECISIONS_TO_CONFIRM.yaml`. Backend deviation from
the detailed design is recorded in `docs/adr/ADR-19-backend-profile-nestjs.md`.

## Approved profile

- Web: React, TypeScript, Vite; deployed to Vercel for dev/demo sharing
- API: NestJS (Node 20+, TypeScript) — ADR-19
- Data access: migration-reproducible tool (finalized at CC-004) plus explicit SQL for projection/high-volume paths
- DB: PostgreSQL 16+
- Background work: NestJS worker service and PostgreSQL-backed job/outbox queue initially
- Object storage: MinIO locally; any S3-compatible store (R2/Supabase) in cloud demo, behind one storage port
- HWPX: pinned rhwp Rust/WASM core (ADR-15) consumed through a UNE TypeScript adapter; HWPX engine image and CI include the Rust+wasm toolchain; Python tools only behind explicit interfaces
- Tests: Vitest/Jest, Testcontainers-node, Playwright, pytest for Python tools; Track A export validators in CI and a Windows/Hancom Track B runner as the G4 release gate (ADR-16)
- Package manager: pnpm (workspaces)
- Branch policy: trunk-based; feature/CC-<id> branches per Work Item merged to main after gate review; no force-push to main
- Local runtime: Docker Compose via free path (WSL2 Docker Engine CE, Rancher Desktop, or Podman)
- CI: GitHub Actions

## Deployment constraints

- Developer PCs are on internal networks without fixed IPs. Team/meeting-room
  demos require public URLs: frontend on Vercel, backend as containers on a
  cloud host (OB-14, decide before first G2 demo), managed PostgreSQL,
  S3-compatible storage.
- Backend/worker/HWPX engine stay containerized; never Vercel serverless
  functions (long-running workers, outbox polling, SSE, long HWPX jobs).
- Shared demo environments carry masked/sample data only.
- Public demo environments require access control on both sides: frontend
  (Vercel Deployment Protection/SSO or basic auth) and backend (IP allowlist
  or gateway auth). mock-jwt only with AUTH_MODE=mock, signing key from
  environment secrets, never in environments with unmasked data.
- Final delivery environment: OPEN (OB-14).

## Still OPEN

- demo backend host and final delivery environment (OB-14)
- Hancom test version for Track B (OB-08, decide before G4)
- data access / migration tool (node-pg-migrate vs Prisma migrate — finalized at CC-004)
