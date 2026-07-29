from pathlib import Path
import json, re, sys, yaml
from jsonschema import Draft202012Validator

ROOT=Path(__file__).resolve().parents[1]
errors=[]

for p in (ROOT/'03_json_schema').glob('*.json'):
    try:
        Draft202012Validator.check_schema(json.loads(p.read_text(encoding='utf-8')))
    except Exception as e: errors.append(f'{p}: {e}')

for p in (ROOT/'02_openapi').glob('*.yaml'):
    try:
        doc=yaml.safe_load(p.read_text(encoding='utf-8'))
        assert str(doc.get('openapi','')).startswith('3.1')
        assert doc.get('paths')
        ids=[]
        for path,item in doc['paths'].items():
            params=set(re.findall(r'\{([^}]+)\}',path))
            for method,op in item.items():
                if method.lower() not in {'get','post','put','patch','delete','options','head'}: continue
                assert 'responses' in op
                if op.get('operationId'): ids.append(op['operationId'])
                declared={x.get('name') for x in op.get('parameters',[]) if isinstance(x,dict) and x.get('in')=='path'}
                if params-declared: errors.append(f'{p}:{method.upper()} {path} missing path params {params-declared}')
        if len(ids)!=len(set(ids)): errors.append(f'{p}: duplicate operationId')
    except Exception as e: errors.append(f'{p}: {e}')

for p in (ROOT/'04_database'/'ddl').glob('*.sql'):
    txt=p.read_text(encoding='utf-8')
    if txt.count('(')!=txt.count(')'): errors.append(f'{p}: unbalanced parentheses')

if errors:
    print('\n'.join(errors)); sys.exit(1)
print('VALIDATION_OK')
