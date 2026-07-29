# API Contract Test Plan

- OpenAPI 3.1 YAML 파싱 및 모든 operationId 유일성 검사
- 121개 Endpoint의 Path Parameter 선언 일치 검사
- POST/PUT/PATCH의 요청 Schema 및 표준 오류 응답 존재 검사
- SSE Endpoint의 `text/event-stream`과 종료 이벤트 검사
- T3Q RPT-001/002 요청·응답 JSON Contract Test
- UNI `/documents/upload`, `/search/`, `/chat/json`, `/chat/` Adapter Contract Test
- Idempotency-Key, If-Match, X-Correlation-Id 전파 검사
- Provider 오류 502/503/504를 UNE 오류 Envelope로 변환하는지 검사
