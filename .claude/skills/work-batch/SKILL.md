---
name: work-batch
description: "/work-batch <gate|phase> — MASTER_WORK_ITEMS.yaml과 PARALLEL_EXECUTION_PLAN.yaml을 읽어 착수 가능한 독립 Work Item들을 specialist 서브에이전트에 병렬 디스패치하는 오케스트레이터. 예: /work-batch G0, /work-batch phase_1"
---

# work-batch — 병렬 Work Item 오케스트레이터

메인 세션이 직접 오케스트레이션한다 (서브에이전트에게 오케스트레이션을 위임하지 않는다).

## 절차

1. **상태 로드**: `work-items/MASTER_WORK_ITEMS.yaml`(정본 dependencies/status)과
   `work-items/PARALLEL_EXECUTION_PLAN.yaml`(병렬 오버레이), `work-items/IMPLEMENTATION_STATUS.md`를 읽는다.
2. **착수 가능 집합 계산**: 요청된 gate/phase 범위에서, 정본 dependencies가 전부 DONE이거나
   오버레이의 early-start 선언에 해당하는 NOT_STARTED/PLANNED 항목을 고른다.
   - `blocked_by_open_binding`이 걸린 항목은 해당 OPEN Binding(`docs/handoff/OPEN_BINDINGS.md`)이
     해소되지 않았으면 제외하고 사유를 보고한다.
   - CC-000이 미승인(`work-items/00_DECISIONS_TO_CONFIRM.yaml` status: OPEN)이면 CC-001 이후는
     디스패치하지 않고 멈춰서 사용자에게 결정표를 제시한다.
3. **디스패치 계획 제시**: 트랙별 항목·담당 에이전트·worktree 여부·예상 충돌 경로를 표로
   보여주고 사용자 승인을 받는다 (파괴적이지 않은 단일 항목 재실행은 생략 가능).
4. **병렬 디스패치**: 오버레이의 `agent_mapping`에 따라 각 트랙을 담당 specialist 서브에이전트에
   **한 메시지에서 동시에 Task 호출**한다.
   - `worktree: true` 트랙은 Task 옵션 `isolation: worktree`로 격리한다 (파일 충돌 방지).
   - 각 Task 프롬프트에는 반드시 포함: Work Item ID·title·acceptance_criteria·design_refs,
     `implement-work-item` 스킬 절차 준수 지시, OPEN Binding 추정 금지, 관련 `.claude/rules/*` 파일 경로.
   - 트랙 내부가 직렬(예: CC-002→CC-004)이면 한 에이전트에게 순서대로 묶어 맡긴다.
5. **항목별 게이트**: 각 트랙 완료 보고가 오는 즉시 (다른 트랙을 기다리지 않고)
   `architecture-guardian`과 `qa-gate-reviewer`를 **동시 Task 호출**로 리뷰시킨다.
   FAIL이면 거절 노트를 담당 specialist에게 전달해 수정 (최대 3회, 이후 사용자 보고).
6. **합류점 처리**: 오버레이 `join`의 requires가 전부 PASS되면 합류 항목을 디스패치한다.
7. **배치 종료 처리**: 범위 내 전 항목 종료 후
   - `work-items/IMPLEMENTATION_STATUS.md`(상태·Branch·Evidence·Next action),
     `work-items/CHANGELOG.md`, `docs/handoff/SESSION_HANDOFF.md`를 갱신한다.
   - worktree 트랙의 브랜치를 main에 병합한다 (충돌 시 사용자 보고).
   - 커밋 메시지를 제안한다 (자동 push 금지).
8. **보고**: 완료/조건부/차단 항목, 증거 경로, 다음 배치에서 착수 가능해진 항목을 요약한다.

## 규칙

- 정본 `MASTER_WORK_ITEMS.yaml`의 dependencies를 위반하는 디스패치 금지. 오버레이는
  독립성 선언일 뿐 의존성 완화가 아니다.
- 서브에이전트는 전부 opus 모델을 사용한다 (agents frontmatter에 지정됨). Sonnet 금지.
- 한 Work Item의 범위를 넘는 변경을 한 Task에 섞지 않는다 (CONTRIBUTING.md).
- Phase 3의 CC-260/270 병렬 분리 전에는 트랜잭션 경계 소유권(단일 트랜잭션 규칙)을
  메인 세션이 확정해 양 트랙 프롬프트에 명시한다.
- 완료 판정 증거 없이 DONE 전환 금지 (DEFINITION_OF_DONE.md 10항목).
