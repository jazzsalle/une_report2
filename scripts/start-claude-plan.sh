#!/usr/bin/env bash
set -euo pipefail
command -v claude >/dev/null || { echo "Claude Code CLI not found" >&2; exit 1; }
cd "$(dirname "$0")/.."
exec claude --permission-mode plan
