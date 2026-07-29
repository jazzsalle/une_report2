from pathlib import Path
import json, sys, hashlib
try:
    import yaml
except Exception:
    yaml = None

root = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
required = [
    'CLAUDE.md', 'REVIEW.md', '.claude/settings.json',
    'docs/handoff/IMPLEMENTATION_BASELINE.md',
    'work-items/00_DECISIONS_TO_CONFIRM.yaml',
    'work-items/MASTER_WORK_ITEMS.yaml',
    'contracts/openapi/une-platform-api-v1.yaml',
    'database/migrations/V001__extensions_and_common.sql'
]
errors=[]
for rel in required:
    p=root/rel
    if not p.exists() or p.stat().st_size == 0:
        errors.append(f'missing or empty: {rel}')

for p in root.rglob('*.json'):
    try: json.loads(p.read_text(encoding='utf-8'))
    except Exception as e: errors.append(f'invalid json {p.relative_to(root)}: {e}')

if yaml:
    for p in list(root.rglob('*.yaml')) + list(root.rglob('*.yml')):
        try: yaml.safe_load(p.read_text(encoding='utf-8'))
        except Exception as e: errors.append(f'invalid yaml {p.relative_to(root)}: {e}')

claude=(root/'CLAUDE.md').read_text(encoding='utf-8') if (root/'CLAUDE.md').exists() else ''
if len(claude.splitlines()) > 200:
    errors.append(f'CLAUDE.md exceeds 200 lines: {len(claude.splitlines())}')

if errors:
    print('HANDOFF VALIDATION: FAIL')
    for e in errors: print('-',e)
    sys.exit(1)
print('HANDOFF VALIDATION: PASS')
print('root:',root)
print('files:',sum(1 for p in root.rglob('*') if p.is_file()))
