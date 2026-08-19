# External Dependencies and Provider Bindings

Version: 1.1  
Date: 2026-07-28

## Binding classes

| Target | Class | Project use |
|---|---|---|
| ProcessGPT | reference architecture and optional POC | analyze BPMN, agent orchestration, MCP tool execution, Office/HWPX control; do not replace UNE domains |
| process-gpt-office-mcp | reference MCP server and optional isolated adapter | evaluate tool contracts for document control; do not make it a hidden runtime dependency |
| rhwp | primary HWP/HWPX editor/engine candidate | pin a reviewed tag or commit, import source archive, build UNE adapter and compatibility tests |
| UNI API | active POC provider for situation/knowledge/SOP | call only through UNE backend adapter; actual base path and auth are OPEN until verified |
| T3Q API | production plan-generation provider | current RPT-001/002 via legacy adapter; target v2 via mock and requested contract until T3Q accepts it |

## Official upstream references

- ProcessGPT service: https://www.process-gpt.io
- ProcessGPT source: https://github.com/uengine-oss/process-gpt
- ProcessGPT Office MCP: https://github.com/uengine-oss/process-gpt-office-mcp
- ProcessGPT documentation: https://docs.process-gpt.io
- rhwp source: https://github.com/edwardkim/rhwp
- rhwp releases: https://github.com/edwardkim/rhwp/releases
- rhwp demo: https://edwardkim.github.io/rhwp/
- UNI API host: http://10.20.10.101:8088 (실측 2026-08-18, ADR-51). 웹 UI는 http://10.20.10.101:3101 — API 아님

## Non-negotiable rules

1. Plan flow must never call UNI, even as an automatic fallback.
2. Current T3Q RPT-001/002 support and target-v2 mock support must be reported separately.
3. ProcessGPT is not accepted as the UNE workflow database, SOP owner, execution ledger, or outbox.
4. rhwp upstream source, UNE adapter, and patches remain separated.
5. No API base path, authentication method, TLS policy, rate limit, or payload field is guessed.
6. Secrets are environment variables or secret-store references only.
