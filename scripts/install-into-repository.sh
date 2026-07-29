#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 ]]; then echo "usage: $0 /path/to/repository" >&2; exit 2; fi
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DST="$(cd "$1" && pwd)"
if [[ ! -d "$DST/.git" ]]; then echo "target is not a git repository: $DST" >&2; exit 1; fi
rsync -av --exclude 'docs/design-docx' --exclude 'docs/design-markdown' "$SRC/" "$DST/"
echo "Core Claude development package installed. Copy design docs separately if desired."
