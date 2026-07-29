#!/usr/bin/env bash
# SessionStart hook: SESSION_HANDOFF.md + 구현 진행상태 + git 상태를
# additionalContext(JSON)로 주입한다. 내용은 명령문이 아닌 사실 진술.
set -u
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

HANDOFF=""
if [ -f docs/handoff/SESSION_HANDOFF.md ]; then
  HANDOFF="$(cat docs/handoff/SESSION_HANDOFF.md)"
fi

# IMPLEMENTATION_STATUS: NOT_STARTED가 아닌 행만 (진행 중인 것 위주 요약)
STATUS_ACTIVE=""
if [ -f work-items/IMPLEMENTATION_STATUS.md ]; then
  STATUS_ACTIVE="$(grep '^|' work-items/IMPLEMENTATION_STATUS.md | grep -v 'NOT_STARTED' || true)"
fi

GIT_INFO=""
if git rev-parse --git-dir >/dev/null 2>&1; then
  BRANCH="$(git branch --show-current 2>/dev/null)"
  COMMITS="$(git log --oneline -5 2>/dev/null)"
  DIRTY="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  GIT_INFO="branch: ${BRANCH}
recent commits:
${COMMITS}
uncommitted changes: ${DIRTY}"
fi

CONTEXT="[세션 시작 컨텍스트 — 사실 진술]

## 이전 세션 핸드오프 (docs/handoff/SESSION_HANDOFF.md)
${HANDOFF}

## 진행 중인 Work Item (NOT_STARTED 제외)
${STATUS_ACTIVE:-'(없음 — 전 항목 NOT_STARTED)'}

## Git 상태
${GIT_INFO}"

# 한글 안전 JSON 직렬화는 python 사용, 9000자 절단. python 없으면 plain stdout 폴백.
if command -v python >/dev/null 2>&1; then PY=python
elif command -v python3 >/dev/null 2>&1; then PY=python3
else
  printf '%s\n' "$CONTEXT"
  exit 0
fi

printf '%s' "$CONTEXT" | "$PY" -c 'import json,sys; print(json.dumps({"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":sys.stdin.read()[:9000]}},ensure_ascii=False))'
