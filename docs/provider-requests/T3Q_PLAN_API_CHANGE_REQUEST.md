# T3Q Plan API Change and Addition Request

Official DOCX: `docs/design-docx/13_T3Q_PLAN_API_CHANGE_REQUEST_v1.0.docx`  
Machine contract: `contracts/openapi/t3q-plan-api-change-request-v1.yaml`

## Decision
UNE development does not wait for provider changes. Current RPT-001/002 are wrapped in `LegacyT3qPlanAdapter`; the requested contract is implemented first as `TargetV2T3qPlanAdapter` plus mock/contract tests. Both implement one `T3qPlanProvider` port. Plan flow has no UNI fallback.

## Requests
| ID | Priority | Request |
|---|---|---|
| CR-T3Q-001 | MUST | RPT-001 structured TOC v2 with stable section IDs and semantic/generation policy |
| CR-T3Q-002 | MUST | RPT-002 structured ContentBlock, scoped generation, protected blocks, partial result |
| CR-T3Q-003 | MUST | asynchronous jobs, status, SSE, cancel, section/block retry |
| CR-T3Q-004 | MUST | semantic edit proposal for Range/Block/Section with revision conflict control |
| CR-T3Q-005 | SHOULD | evidence search with source/document/page/chunk provenance |
| CR-T3Q-006 | SHOULD | semantic validation and issue list |
| CR-T3Q-007 | CONDITIONAL | plan reference-document upload when no common ingestion endpoint exists |
| CR-T3Q-009 | MUST | capability/version/limit discovery |

## Provider truth
Mock support, UNE adapter support, T3Q development support, and T3Q production verification are four distinct states. Never collapse them into a single “supported” flag.
