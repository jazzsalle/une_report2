import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import {
  CHANGE_OPERATION_TYPES,
  CHANGE_SET_ORIGINS,
  SELECTION_KINDS,
  type ChangeOperationType,
} from '@une/domain';
import { ajvErrors, contractValidators, loadJson, loadYaml } from './contract-loader';

/**
 * CC-150 — contracts/schemas/change-set.schema.json과 UNE-DOC-005~009 계약.
 *
 * 세 가지를 고정한다.
 *   1. 스키마가 실제로 컴파일되고, 자기 examples를 통과시킨다.
 *   2. 어휘가 packages/domain과 **글자 단위로** 같다. 어휘를 두 곳에 적는 순간
 *      갈라지므로, 갈라졌는지를 시험이 대신 본다.
 *   3. ADR-24 D4의 함정(allOf + additionalProperties:false)이 재발하지 않았다.
 *      이 저장소에서 두 번 재발한 결함이라 문장이 아니라 시험으로 막는다.
 */

const SCHEMA_FILE = ['contracts', 'schemas', 'change-set.schema.json'];
const CONTRACT = ['contracts', 'openapi', 'une-platform-api-v1.yaml'];

function compileChangeSetSchema(): ValidateFunction {
  const schema = loadJson(...SCHEMA_FILE);
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

const REV = '3f1c1a52-2b0f-4a1e-9f2d-6c7b8a9d0e11';

/** 각 연산 유형의 최소 유효 인스턴스(§1.9 "필수 인자" 표). */
const MINIMAL_OPERATIONS: Record<ChangeOperationType, Record<string, unknown>> = {
  INSERT_BLOCKS: {
    type: 'INSERT_BLOCKS',
    order: 0,
    anchor: { relation: 'AFTER', ref: 'P-1' },
    source: { kind: 'INLINE', blocks: [{ text: '가' }] },
  },
  REPLACE_RANGE: {
    type: 'REPLACE_RANGE',
    order: 0,
    selection: {
      kind: 'TEXT_RANGE',
      baseRevisionId: REV,
      start: { paragraphId: 'P-1', offset: 0 },
      end: { paragraphId: 'P-1', offset: 2 },
    },
    payload: { text: '나' },
  },
  DELETE_RANGE: {
    type: 'DELETE_RANGE',
    order: 0,
    selection: { kind: 'BLOCK', baseRevisionId: REV, blockIds: ['P-1'] },
  },
  SPLIT_PARAGRAPH: {
    type: 'SPLIT_PARAGRAPH',
    order: 0,
    selection: { kind: 'CURSOR', baseRevisionId: REV, at: { paragraphId: 'P-1', offset: 3 } },
  },
  MERGE_PARAGRAPHS: {
    type: 'MERGE_PARAGRAPHS',
    order: 0,
    payload: { leftId: 'P-1', rightId: 'P-2' },
  },
  MOVE_BLOCK: {
    type: 'MOVE_BLOCK',
    order: 0,
    anchor: { relation: 'BEFORE', ref: 'P-9' },
    payload: { blockId: 'P-1' },
  },
  APPLY_STYLE_ROLE: {
    type: 'APPLY_STYLE_ROLE',
    order: 0,
    payload: { blockId: 'P-1', styleRole: 'OUTLINE_2' },
  },
  TABLE_PATCH: {
    type: 'TABLE_PATCH',
    order: 0,
    payload: { tableId: 'T-1', cellOps: [{ cellId: 'C-1' }] },
  },
};

function request(operations: unknown[], extra: Record<string, unknown> = {}): unknown {
  return {
    baseRevisionId: REV,
    origin: 'USER',
    clientMutationId: 'edit-0001',
    operations,
    ...extra,
  };
}

describe('change-set.schema.json', () => {
  const validate = compileChangeSetSchema();

  it('스키마의 examples가 스스로를 통과한다', () => {
    const schema = loadJson(...SCHEMA_FILE) as { examples: unknown[] };
    expect(schema.examples.length).toBeGreaterThanOrEqual(3);
    for (const example of schema.examples) {
      expect(validate(example), ajvErrors(validate)).toBe(true);
    }
  });

  it('8종 연산의 최소 유효 인스턴스를 모두 받는다', () => {
    for (const type of CHANGE_OPERATION_TYPES) {
      const instance = request([MINIMAL_OPERATIONS[type]]);
      expect(validate(instance), `${type}: ${ajvErrors(validate)}`).toBe(true);
    }
  });

  it('연산 유형별 필수 인자를 강제한다', () => {
    // anchor/source 없는 INSERT_BLOCKS
    expect(validate(request([{ type: 'INSERT_BLOCKS', order: 0 }]))).toBe(false);
    // selection 없는 REPLACE_RANGE
    expect(validate(request([{ type: 'REPLACE_RANGE', order: 0, payload: { text: 'x' } }]))).toBe(
      false,
    );
    // leftId/rightId 없는 MERGE_PARAGRAPHS
    expect(
      validate(request([{ type: 'MERGE_PARAGRAPHS', order: 0, payload: { leftId: 'P-1' } }])),
    ).toBe(false);
    // tableId/cellOps 없는 TABLE_PATCH
    expect(
      validate(request([{ type: 'TABLE_PATCH', order: 0, payload: { tableId: 'T-1' } }])),
    ).toBe(false);
  });

  it('APPLY_STYLE_ROLE은 styleId 직접 지정을 거부한다(§1.9)', () => {
    expect(
      validate(
        request([
          {
            type: 'APPLY_STYLE_ROLE',
            order: 0,
            payload: { blockId: 'P-1', styleRole: 'BODY', styleId: 7 },
          },
        ]),
      ),
    ).toBe(false);
    // 다른 연산의 payload는 열려 있다 — 금지는 이 연산에만 걸린다(실행기와 동일).
    expect(
      validate(
        request([{ ...MINIMAL_OPERATIONS.REPLACE_RANGE, payload: { text: 'x', styleId: 7 } }]),
      ),
    ).toBe(true);
  });

  it('SelectionEnvelope 5종을 받고 화면좌표/원시 앵커는 거부한다(§1.8-4)', () => {
    const envelopes: Record<string, unknown>[] = [
      { kind: 'CURSOR', baseRevisionId: REV, at: { paragraphId: 'P-1', offset: 0 } },
      {
        kind: 'TEXT_RANGE',
        baseRevisionId: REV,
        start: { paragraphId: 'P-1', offset: 0 },
        end: { paragraphId: 'P-1', offset: 1 },
      },
      { kind: 'BLOCK', baseRevisionId: REV, blockIds: ['P-1'] },
      { kind: 'SECTION', baseRevisionId: REV, sectionId: 'S-1' },
      { kind: 'TABLE_CELL', baseRevisionId: REV, tableId: 'T-1', cellId: 'C-1' },
    ];
    expect(envelopes).toHaveLength(SELECTION_KINDS.length);
    for (const selection of envelopes) {
      expect(
        validate(request([{ type: 'DELETE_RANGE', order: 0, selection }])),
        `${String(selection.kind)}: ${ajvErrors(validate)}`,
      ).toBe(true);
      // 좌표를 하나 얹으면 그 즉시 무효다.
      expect(
        validate(request([{ type: 'DELETE_RANGE', order: 0, selection: { ...selection, x: 3 } }])),
      ).toBe(false);
    }
  });

  it('materialize 소스 3종을 구분해 받는다', () => {
    const sources: unknown[] = [
      { kind: 'INLINE', blocks: [{ text: '가', styleRole: 'BODY', outlineLevel: 1 }] },
      { kind: 'PROTOTYPE', prototypeId: 'PROTO-1', count: 3 },
      { kind: 'GENERATED_BLOCKS', planId: REV, tocVersionId: REV },
    ];
    for (const source of sources) {
      expect(
        validate(
          request([
            {
              type: 'INSERT_BLOCKS',
              order: 0,
              anchor: { relation: 'LAST_CHILD', ref: 'S-1' },
              source,
            },
          ]),
        ),
        ajvErrors(validate),
      ).toBe(true);
    }
    // 변형을 섞으면(INLINE + planId) oneOf가 하나도 맞지 않는다.
    expect(
      validate(
        request([
          {
            type: 'INSERT_BLOCKS',
            order: 0,
            anchor: { relation: 'LAST_CHILD', ref: 'S-1' },
            source: { kind: 'INLINE', blocks: [{ text: 'x' }], planId: REV },
          },
        ]),
      ),
    ).toBe(false);
  });

  it('오프셋은 0 이상의 정수여야 한다(UTF-16 코드 단위)', () => {
    for (const offset of [-1, 1.5]) {
      expect(
        validate(
          request([
            {
              type: 'SPLIT_PARAGRAPH',
              order: 0,
              selection: {
                kind: 'CURSOR',
                baseRevisionId: REV,
                at: { paragraphId: 'P-1', offset },
              },
            },
          ]),
        ),
      ).toBe(false);
    }
  });

  it('빈 연산 목록과 알 수 없는 최상위 항목을 거부한다', () => {
    expect(validate(request([]))).toBe(false);
    expect(validate(request([MINIMAL_OPERATIONS.DELETE_RANGE], { unknownField: 1 }))).toBe(false);
  });
});

describe('어휘 동기(스키마 ↔ @une/domain ↔ OpenAPI)', () => {
  const schema = loadJson(...SCHEMA_FILE) as {
    $defs: {
      changeOperationType: { enum: string[] };
      changeSetOrigin: { enum: string[] };
      selectionEnvelope: { oneOf: { properties: { kind: { const: string } } }[] };
    };
  };
  const contract = loadYaml(...CONTRACT) as {
    components: {
      schemas: Record<
        string,
        { enum?: string[]; properties?: Record<string, { enum?: string[] }> }
      >;
    };
  };

  it('8종 연산 어휘가 세 곳에서 같다', () => {
    expect(schema.$defs.changeOperationType.enum).toEqual([...CHANGE_OPERATION_TYPES]);
    expect(contract.components.schemas.ChangeOperationType.enum).toEqual([
      ...CHANGE_OPERATION_TYPES,
    ]);
  });

  it('7종 ChangeSet 출처 어휘가 세 곳에서 같다', () => {
    expect(schema.$defs.changeSetOrigin.enum).toEqual([...CHANGE_SET_ORIGINS]);
    expect(contract.components.schemas.ChangeSetOrigin.enum).toEqual([...CHANGE_SET_ORIGINS]);
  });

  it('5종 선택 어휘가 세 곳에서 같다', () => {
    expect(schema.$defs.selectionEnvelope.oneOf.map((b) => b.properties.kind.const)).toEqual([
      ...SELECTION_KINDS,
    ]);
    expect(contract.components.schemas.SelectionEnvelope.properties?.kind.enum).toEqual([
      ...SELECTION_KINDS,
    ]);
  });

  it('Revision 출처 어휘는 0019의 CHECK와 같다', () => {
    // ck_document_revision_origin. ChangeSet 출처와 다른 집합인 것이 정상이다
    // (누가 요청했나 vs 어떤 기제가 만들었나).
    expect(contract.components.schemas.RevisionOrigin.enum).toEqual([
      'IMPORT',
      'MATERIALIZE',
      'CHANGESET',
      'AUTOSAVE',
      'UNDO',
      'REDO',
      'RESTORE',
    ]);
  });
});

describe('ADR-24 D4 함정 회귀 방지', () => {
  it('change-set.schema.json 어디에도 allOf 형제로 additionalProperties:false가 없다', () => {
    // 2020-12에서 allOf 브랜치는 형제 브랜치의 property를 보지 못한다. 그 조합이
    // 들어가면 모든 인스턴스가 무효가 되는데, 예제 시험만으로는 "스키마가 원래
    // 그런 것"과 구별되지 않아 조용히 통과할 수 있다. 구조 자체를 금지한다.
    const schema = loadJson(...SCHEMA_FILE);
    const offenders: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${path}[${index}]`));
        return;
      }
      if (node === null || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      for (const combinator of ['allOf', 'anyOf', 'oneOf']) {
        const branches = record[combinator];
        if (!Array.isArray(branches)) continue;
        // oneOf/anyOf에서 각 브랜치가 완결된 객체를 쓰는 것은 안전하다 —
        // 위험한 것은 형제 브랜치에 property를 나눠 둔 채 닫는 경우다.
        // allOf는 항상 결합되므로 브랜치 안의 닫힘이 곧 결함이다.
        if (combinator !== 'allOf') continue;
        branches.forEach((branch, index) => {
          if (
            branch !== null &&
            typeof branch === 'object' &&
            (branch as Record<string, unknown>).additionalProperties === false
          ) {
            offenders.push(`${path}.allOf[${index}]`);
          }
        });
      }
      for (const [key, value] of Object.entries(record)) walk(value, `${path}.${key}`);
    };
    walk(schema, '#');
    expect(offenders).toEqual([]);
  });

  it('oneOf 브랜치는 각자 완결된 객체다(형제에 의존하지 않는다)', () => {
    const schema = loadJson(...SCHEMA_FILE) as {
      $defs: {
        selectionEnvelope: { oneOf: Record<string, unknown>[] };
        insertSource: { oneOf: Record<string, unknown>[] };
      };
    };
    for (const def of [schema.$defs.selectionEnvelope, schema.$defs.insertSource]) {
      for (const branch of def.oneOf) {
        expect(branch.type).toBe('object');
        expect(branch.additionalProperties).toBe(false);
        expect(Object.keys(branch.properties as object).length).toBeGreaterThan(1);
        // 브랜치가 $ref 하나로만 이루어져 있으면 닫힘이 형제를 못 본다.
        expect(branch.$ref).toBeUndefined();
      }
    }
  });
});

describe('UNE-DOC-005~009 계약 표면', () => {
  const doc = loadYaml(...CONTRACT) as {
    paths: Record<string, Record<string, Record<string, unknown>>>;
    components: { parameters: Record<string, unknown>; responses: Record<string, unknown> };
  };
  const operations = new Map<string, Record<string, unknown>>();
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      const id = operation['x-une-api-id'];
      if (typeof id === 'string' && /^UNE-DOC-00[5-9]$/.test(id)) {
        operations.set(id, { ...operation, __path: path, __method: method });
      }
    }
  }

  it('설계 10 §3.4의 경로·메서드·권한을 그대로 쓴다', () => {
    const expected: Record<string, [string, string, string]> = {
      'UNE-DOC-005': ['get', '/documents/{documentId}/ir', 'DOC_READ'],
      'UNE-DOC-006': ['post', '/documents/{documentId}/changesets', 'DOC_EDIT'],
      'UNE-DOC-007': ['get', '/documents/{documentId}/revisions', 'DOC_READ'],
      'UNE-DOC-008': ['post', '/documents/{documentId}/revisions/{revisionId}/restore', 'DOC_EDIT'],
      'UNE-DOC-009': ['post', '/documents/{documentId}/autosaves', 'DOC_EDIT'],
    };
    for (const [id, [method, path, permission]] of Object.entries(expected)) {
      const operation = operations.get(id);
      expect(operation, `${id} 누락`).toBeDefined();
      expect(operation?.__method).toBe(method);
      expect(operation?.__path).toBe(path);
      expect(operation?.['x-permission']).toBe(permission);
    }
  });

  it('쓰기 3종은 If-Match를 필수로 선언하고 409/422/428을 갖는다', () => {
    for (const id of ['UNE-DOC-006', 'UNE-DOC-008', 'UNE-DOC-009']) {
      const operation = operations.get(id) as {
        parameters: { $ref?: string }[];
        responses: Record<string, { $ref?: string }>;
      };
      expect(
        operation.parameters.some((p) => p.$ref === '#/components/parameters/IfMatchRequired'),
        `${id}: If-Match 필수 선언 누락`,
      ).toBe(true);
      expect(operation.responses['428']?.$ref).toBe('#/components/responses/PreconditionRequired');
      expect(operation.responses['422']?.$ref).toBe('#/components/responses/Unprocessable');
      // 충돌은 복구 정보(ETag 헤더 + meta.conflict)를 싣는 전용 응답이다.
      expect(operation.responses['409']?.$ref).toBe('#/components/responses/RevisionConflict');
    }
  });

  it('다섯 오퍼레이션 모두 200 응답에 ETag 헤더를 선언한다', () => {
    for (const [id, operation] of operations) {
      const responses = operation.responses as Record<
        string,
        { headers?: Record<string, unknown> }
      >;
      expect(responses['200']?.headers?.ETag, `${id}: ETag 헤더 선언 누락`).toBeDefined();
    }
  });

  it('DOC-* 오류 코드가 x-error-codes에 선언되어 있다', () => {
    const expected: Record<string, string[]> = {
      'UNE-DOC-005': ['DOC-404-001', 'DOC-404-002'],
      'UNE-DOC-006': ['DOC-409-001', 'DOC-422-004', 'COM-0409', 'COM-0428'],
      'UNE-DOC-007': ['DOC-404-002'],
      'UNE-DOC-008': ['DOC-409-002', 'DOC-404-001', 'DOC-422-004', 'COM-0428'],
      'UNE-DOC-009': ['DOC-409-003', 'DOC-422-004', 'COM-0409', 'COM-0428'],
    };
    for (const [id, codes] of Object.entries(expected)) {
      const declared = operations.get(id)?.['x-error-codes'] as string[];
      for (const code of codes) expect(declared, `${id}`).toContain(code);
    }
  });

  it('RevisionConflict 응답이 meta.conflict를 구조로 요구한다', () => {
    const responses = doc.components.responses as Record<
      string,
      { headers?: Record<string, unknown>; content: Record<string, { schema: { $ref: string } }> }
    >;
    const conflict = responses.RevisionConflict;
    expect(conflict.headers?.ETag).toBeDefined();
    expect(conflict.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/RevisionConflictEnvelope',
    );
    const validators = contractValidators(...CONTRACT);
    const validate = validators.compile('RevisionConflictEnvelope');
    const sample = {
      success: false,
      error: { code: 'DOC-409-001', message: '충돌', detail: null, recoverable: true },
      meta: {
        requestId: 'req_1',
        correlationId: 'corr_1',
        timestamp: '2026-08-01T00:00:00.000Z',
        schemaVersion: '1.0',
        conflict: {
          currentRevisionId: REV,
          currentRevisionNo: 4,
          headIrHash: 'a'.repeat(64),
        },
      },
    };
    expect(validate(sample), ajvErrors(validate)).toBe(true);
    // conflict 항목이 빠지면 무효다 — 복구 정보 없는 409는 클라이언트가 쓸 수 없다.
    const { conflict: _dropped, ...metaWithoutConflict } = sample.meta;
    expect(validate({ ...sample, meta: metaWithoutConflict })).toBe(false);
  });

  it('UNE-DOC-004의 x-db-tables가 구현 테이블 이름(style_prototype)을 가리킨다', () => {
    // 설계 §6.23의 doc_prototype_registry는 구현·마이그레이션에 존재하지 않는다.
    // 계약이 없는 테이블을 가리키면 x-db-tables가 검증 가능한 사실이 아니게 된다.
    const analysis = doc.paths['/documents/{documentId}/analysis'].get as {
      'x-db-tables': string[];
    };
    expect(analysis['x-db-tables']).toContain('style_prototype');
    expect(analysis['x-db-tables']).not.toContain('prototype_registry');
  });

  it('IfMatchRequired 파라미터는 강한 태그만 받는다', () => {
    const parameter = doc.components.parameters.IfMatchRequired as {
      required: boolean;
      schema: { pattern: string };
    };
    expect(parameter.required).toBe(true);
    const pattern = new RegExp(parameter.schema.pattern);
    expect(pattern.test('"3"')).toBe(true);
    expect(pattern.test('3')).toBe(true);
    expect(pattern.test('W/"3"')).toBe(false);
  });
});
