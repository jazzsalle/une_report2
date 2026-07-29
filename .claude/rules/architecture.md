# Architecture Rules

- Domain services depend on ports/interfaces, never directly on T3Q, UNI, SMS, email, or storage SDKs.
- Provider-specific DTOs live only under provider adapters.
- State transitions are explicit domain methods or state machines.
- Cross-domain writes use an application service and an explicit transaction boundary.
- Every architectural deviation requires an ADR or approved change record.
