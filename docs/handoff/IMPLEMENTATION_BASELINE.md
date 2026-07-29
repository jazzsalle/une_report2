# Implementation Baseline

## 1. Product boundary

The platform joins two UNE products in one workspace:

1. Disaster Safety Plan Generation Tool
2. Situation Journal and Safe Korea Exercise Support Tool

The common platform provides authentication boundary, RBAC, file/revision management, audit, provider adapters, and HWPX output. The two products share infrastructure but do not share AI providers indiscriminately.

## 2. Plan flow

`SSO -> Plan -> HWPX import/analyze -> PlanContextSnapshot -> T3Q RPT-001 TOC -> user TOC edit -> T3Q RPT-002 content -> rhwp direct edit -> revision/diff -> HWPX export -> validation`

Hard rules:

- T3Q RPT-001/002 only
- no UNI call
- AI owns semantic draft only; UNE engine owns document formatting
- user-edited blocks are protected
- original prototype styles and unknown parts are preserved

## 3. Situation/exercise flow

`Situation registration -> provider/user candidate facts -> conflict resolution -> SituationSnapshot -> knowledge upload/evidence -> UNI SOP POC -> SopGraph mapping -> review/approval -> dry-run/live/exercise run -> dispatch -> acknowledge/start/progress/complete -> Execution Log -> dashboard -> Journal Projection -> HWPX -> evaluation/improvement`

Hard rules:

- external data is candidate until user confirmation
- SituationSnapshot is immutable
- Execution Log is append-only and is the journal's action ledger
- AI wording must be compared with locked facts
- dispatch/outbox and state event are atomic

## 4. Domain aggregates

- Tenant, Organization, User, Role
- Plan, PlanContextSnapshot, TocVersion, GenerationJob
- Document, Revision, Block, ChangeSet, ExportJob
- Situation, SituationFact, FactConflict, SituationSnapshot
- KnowledgeDocument, EvidenceSet
- SOP, SopVersion, SopNode, SopEdge, SopRun
- Task, TaskEvent, Dispatch, OutboxMessage, ChannelDelivery
- ExecutionEvent, DashboardProjection
- Journal, JournalRevision, Evaluation, ImprovementAction

## 5. External boundaries

- T3Q Report Adapter: RPT-001/002, optional RPT-003 only after decision
- UNI Adapter: upload/search/chat-json/chat for POC
- Situation Provider Port: KMA/MOIS primary, SafeKorea secondary, Naver user-requested secondary
- Channel Port: simulation/system mandatory; real SMS/email/messenger after contract

## 6. Implementation profiles

Approved at CC-000 (2026-07-30). This section supersedes the earlier
"ASP.NET Core 8 recommended" baseline — see `docs/adr/ADR-19-backend-profile-nestjs.md`
and `work-items/00_DECISIONS_TO_CONFIRM.yaml`.

- React + TypeScript (Vite), pnpm workspaces
- NestJS (Node 20+, TypeScript) — ADR-19
- PostgreSQL 16+
- S3-compatible object storage port (MinIO locally)
- Python for HWPX experiments or worker tools behind stable API/CLI contracts
- Docker Compose for local dependencies (free path: WSL2 Docker Engine CE / Rancher Desktop / Podman)
- GitHub Actions CI
- Demos require public URLs (no fixed developer IPs): frontend on Vercel,
  backend containers on a cloud host (OB-14); backend never Vercel serverless

## 7. Release gates

- G0: decisions and repository baseline
- G1: OpenAPI/Schema/DB contract validation
- G2: Plan vertical slice POC
- G3: Situation-SOP-Journal vertical slice POC
- G4: HWPX Track A + Hancom Track B
- G5: external provider and institution binding
- G6: security/performance/E2E/acceptance
