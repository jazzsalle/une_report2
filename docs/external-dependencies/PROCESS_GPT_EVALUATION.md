# ProcessGPT Evaluation Baseline

## Objective
Evaluate reusable concepts and source areas without replacing the approved UNE architecture.

## Sources
- https://github.com/uengine-oss/process-gpt
- https://github.com/uengine-oss/process-gpt-office-mcp
- https://docs.process-gpt.io

## Mandatory evaluation
- license and third-party dependency inventory
- BPMN definition and execution lifecycle
- human-in-the-loop and compensation handling
- MCP server/tool contracts and process-to-tool invocation
- HWPX/Office control path, supported operations, deployment assumptions
- audit/event model and how it differs from UNE Execution Log
- source areas that are actually present versus hosted-service-only features
- security boundary for local PC control

## Adoption rule
Adopt only through an isolated adapter or independent MCP server after ADR approval. Do not copy source or bind runtime behavior before license, security, and architecture review. UNE SOP, Task, Transactional Outbox, Execution Log, Journal Projection, and HWPX Document IR remain the source of truth.

## Deliverable
`docs/poc/process-gpt-evaluation-report.md` with KEEP / ADAPT / REJECT decisions and source evidence.
