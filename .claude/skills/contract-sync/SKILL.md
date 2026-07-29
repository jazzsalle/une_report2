---
description: Synchronizes OpenAPI, JSON Schema, API implementation, generated clients, examples, mock server, and contract tests. Use for any API change.
---

- Identify the source contract and affected consumer/provider.
- Update contract first or in the same change as implementation.
- Validate examples and all path parameters.
- Regenerate clients/DTOs using the approved build command.
- Update Mock and contract tests.
- Do not add external fields absent from source specifications; add an OPEN Binding record.
