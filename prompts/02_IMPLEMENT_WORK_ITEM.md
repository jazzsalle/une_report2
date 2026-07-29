# Implement One Work Item

현재 Work Item은 `<CC-ID>`이다.

- 먼저 Work Item, 선행조건, 관련 ADR/설계/화면/API/DB/Sequence를 읽어라.
- git status와 기존 구현을 확인하라.
- 수정할 파일, API, Schema, Migration, 테스트, 위험, OPEN Binding을 계획으로 제시하라.
- 승인된 범위만 구현하라.
- 관련 테스트를 실행하고 결과를 기록하라.
- `architecture-guardian`과 `qa-gate-reviewer` subagent를 **한 메시지에서 동시에(Task 병렬 호출)** 띄워 리뷰를 받아라. 자체 검토로 대체하지 마라. 지적 사항을 해소한 뒤 다음 단계로 진행하라.
- `IMPLEMENTATION_STATUS.md`, `CHANGELOG.md`, `SESSION_HANDOFF.md`를 갱신하라.
- 증거가 없는 완료 주장을 하지 마라.
