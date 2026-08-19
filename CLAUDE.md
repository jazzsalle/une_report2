# UNE Disaster Document Platform

## Mission

Build the UNE-owned parts of RS-2024-00407304 from the approved design baseline. Work in Korean for reports and comments unless code conventions require English.

## Read first

Before modifying code, read:

1. `docs/handoff/IMPLEMENTATION_BASELINE.md`
2. `docs/handoff/TECHNOLOGY_PROFILE.md` and `docs/adr/` (approved profile and post-baseline ADRs)
3. the current item in `work-items/MASTER_WORK_ITEMS.yaml`
4. relevant files under `docs/design-markdown/`
5. relevant OpenAPI, JSON Schema, and SQL migrations

Do not infer requirements only from filenames or previous chat history.

## Source of truth

Priority when documents conflict:

1. ADR v1.1
2. Implementation baseline and approved change records
3. API/DB/Sequence detailed design
4. OpenAPI, JSON Schema, DB migrations
5. Screen and scenario designs
6. HWPX and UNI adapter detailed specifications
7. Master design v0.9 and original requirements

Stop and create an ADR/change request when a conflict cannot be resolved by this order.

## Scope boundary

UNE owns:

- React/TypeScript document workspace
- rhwp-based HWPX analysis, editing adapter, preservation serializer, export validation
- plan workflow and T3Q RPT-001/002 adapter
- SituationFact and immutable SituationSnapshot
- UNI POC adapter and versioned UniSopMapper
- SOP design, approval, run, task, propagation, Transactional Outbox
- Append-only Execution Log, dashboard, journal projection, HWPX output

T3Q owns LLM/RAG, TTS/STT, and external linkage APIs. Do not implement a duplicate chatbot, LLM, embedding pipeline, TTS/STT, or official data collection agent in UNE services.

## Non-negotiable domain rules

- Plan generation calls T3Q RPT-001/002 only. UNI calls in plan flow are prohibited.
- Situation facts come from providers or users and become authoritative only after user confirmation in a SituationSnapshot.
- LLM output is never an authoritative fact source.
- Journal factual cells are projected from SituationSnapshot and Execution Log. AI may improve wording only after fact comparison.
- Approved PlanContextSnapshot, SituationSnapshot, SOP Version, and Execution Event are immutable.
- Corrections are new versions or correction events; never overwrite audit history.
- Dispatch state change, Execution Event, and Outbox insert are one database transaction.
- External provider payloads stay behind adapters and are retained as raw payloads for traceability.
- Every retriable create/dispatch/export request uses an idempotency key.
- Editing uses Revision, ETag/version number, ChangeSet, Diff, and Undo.
- User-edited blocks are protected from regeneration.

## HWPX rules

- Import a specific rhwp tag/commit source archive into internal source control after URL, tag, commit, SHA-256, license, and SBOM are recorded.
- Do not use a public fork as the project baseline.
- Keep upstream source, UNE adapter, and unavoidable patches separate.
- Preserve unsupported objects when surrounding content is edited.
- Classify objects as NATIVE_EDIT, PRESERVE_ONLY, FLATTEN_EXPORT_ONLY, or REJECT.
- Track A automated package/reference/semantic/style validation is required for every export.
- Track B Hancom open-save-reopen testing is a release gate, not a runtime request path.

## External sources and provider contracts

- ProcessGPT references: `https://github.com/uengine-oss/process-gpt`, `https://github.com/uengine-oss/process-gpt-office-mcp`, and `https://docs.process-gpt.io`.
- Treat ProcessGPT as reference architecture and optional POC only. Do not replace UNE SOP, Task, Execution Log, Outbox, Journal Projection, or HWPX IR.
- rhwp upstream is `https://github.com/edwardkim/rhwp`. Never track floating main; record tag/commit, archive SHA-256, license, SBOM, and patch manifest.
- UNI API host is `http://10.20.10.101:8088` (relocated 2026-08-18, ADR-51; the former `221.147.100.161:8000` is dead). `http://10.20.10.101:3101` is the UNI **web UI**, not the API — never use it as an adapter base URL. Do not guess base path or auth. Use backend adapter only and never use UNI in plan flow.
- T3Q current contract is `contracts/openapi/t3q-report-adapter-v0.8.5-une1.yaml`.
- T3Q requested target contract is `contracts/openapi/t3q-plan-api-change-request-v1.yaml`.
- Implement `LegacyT3qPlanAdapter` and `TargetV2T3qPlanAdapter` behind one `T3qPlanProvider` port.
- Continue POC with current RPT-001/002 and target-v2 mocks. Do not wait for T3Q acceptance.
- Never report target mock support as actual T3Q support. Track capability states separately.

## Development workflow

- Implement one Work Item at a time.
- Start with a plan and list affected files, migrations, APIs, tests, and risks.
- Do not change OpenAPI and implementation independently; update both in one change.
- Add a forward-only migration for schema changes. Never edit an applied migration.
- Add or update unit, integration, contract, and E2E tests as applicable.
- Run the smallest relevant test set while editing, then the full gate for the Work Item.
- Update `work-items/IMPLEMENTATION_STATUS.md` with evidence before claiming completion.
- Record unresolved external fields in `docs/handoff/OPEN_BINDINGS.md`; do not invent them.

## Completion evidence

A task is complete only when all are true:

- acceptance criteria pass
- code builds and lint/type checks pass
- required tests pass with commands and results recorded
- API/DB/schema docs match implementation
- error, permission, state, idempotency, concurrency, and audit paths are covered
- no secrets or generated caches are committed
- implementation status and change log are updated

## Safety

Never run destructive commands, push, deploy, rotate credentials, modify production resources, or delete data without explicit user approval. Never use `--dangerously-skip-permissions`. Do not bypass TLS verification in production code.

## Target repository shape

- `apps/web`: React/TypeScript operator workspace
- `apps/field-web`: responsive field task UI
- `services/api`: UNE domain API
- `services/worker`: jobs, outbox, provider polling
- `services/hwpx-engine`: HWPX analysis/serialization boundary
- `packages/domain`: shared domain types and state rules
- `packages/provider-adapters`: T3Q, UNI, official provider adapters
- `contracts`: OpenAPI and JSON Schema
- `database/migrations`: PostgreSQL migrations
- `tests`: unit, contract, integration, E2E
- `docs`: design, ADR, handoff, evidence

## Implementation profile

Approved at CC-000 (2026-07-30, `work-items/00_DECISIONS_TO_CONFIRM.yaml`, ADR-19):

- frontend: React + TypeScript (Vite), pnpm workspaces; dev/demo deploys to Vercel
- backend: NestJS (Node 20+, TypeScript) — ADR-19 supersedes the earlier ASP.NET Core 8 recommendation
- database: PostgreSQL 16+
- object storage: S3-compatible port (MinIO locally)
- HWPX/POC workers: Python where useful, with a stable service contract
- local infrastructure: Docker Compose (free path: WSL2 Docker Engine CE / Rancher Desktop / Podman)
- CI: GitHub Actions
- demos require public URLs (developer PCs have no fixed IP): frontend on Vercel, backend containers on a cloud host (OB-14); backend never runs as Vercel serverless functions

Do not silently change the approved profile.
