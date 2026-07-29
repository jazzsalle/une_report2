# UNI API Binding

## Candidate endpoint
Host inferred from the supplied OpenAPI PDF filename: `http://221.147.100.161:8000`.

Candidate discovery URLs only; verify rather than assume:
- `http://221.147.100.161:8000/openapi.json`
- `http://221.147.100.161:8000/docs`
- `http://221.147.100.161:8000/uni/openapi.json`
- `http://221.147.100.161:8000/uni/docs`

## Intended POC operations
- document upload and processing status
- evidence search
- structured JSON generation for SOP candidates
- SSE/chat generation where useful

## Boundary
- browser must not call UNI directly
- plan generation must not call UNI
- UNI is not a propagation, task, execution-log, or journal fact provider
- raw requests/responses and mapping version are retained
- actual base path, authentication, TLS, timeouts, limits, and error schema remain OPEN until live contract verification
