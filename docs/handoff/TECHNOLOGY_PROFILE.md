# Technology Profile - Approval Required at CC-000

## Recommended default

- Web: React, TypeScript, Vite or approved enterprise build tool
- API: ASP.NET Core 8 Web API
- Data access: EF Core plus explicit SQL for projection/high-volume paths
- DB: PostgreSQL 16+
- Background work: .NET Worker Service and PostgreSQL-backed job/outbox queue initially
- HWPX: rhwp TypeScript adapter where possible; Python tools only behind explicit interfaces
- Tests: xUnit, Testcontainers, Vitest/Playwright, pytest for Python tools
- Local runtime: Docker Compose
- CI: GitHub Actions or company-approved equivalent

## Decisions required

- exact repository and branching policy
- package manager (`npm`, `pnpm`, or company standard)
- backend framework approval
- object storage implementation
- authentication mode for POC and integration
- CI/deployment target
- supported browser and Hancom/Windows versions

Do not start CC-001 until required values in `work-items/00_DECISIONS_TO_CONFIRM.yaml` are approved.
