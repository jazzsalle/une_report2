# Definition of Done

A Work Item may be marked DONE only when:

- dependencies are DONE or explicitly waived
- design and ADR references are identified
- implementation is complete for normal, alternate, exception, permission, conflict, duplicate, and retry paths
- OpenAPI/JSON Schema/DB migration match code
- unit, integration, contract, and required E2E tests pass
- tenant/RBAC/audit/security requirements pass
- logs and errors do not expose secrets or personal data
- HWPX changes have required fixture and validation evidence
- documentation, implementation status, and changelog are updated
- no mandatory OPEN Binding is hidden by a hardcoded assumption
