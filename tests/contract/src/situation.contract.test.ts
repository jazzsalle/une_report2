import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FACT_STATUSES,
  FACT_TYPES,
  PROVIDER_CODES,
  SITUATION_MODES,
  SITUATION_STATUSES,
} from '@une/domain';
import { loadYaml, repoPath } from './contract-loader';

/**
 * CC-200 계약 고정 (ADR-33).
 *
 * 이 파일이 막는 것은 두 가지다.
 *
 * (1) **자리표시자로의 회귀.** `Situation`은 `additionalProperties: true`였고
 *     그래서 예제 게이트가 어떤 응답이든 통과시켰다. 다시 그렇게 되면
 *     계약이 있다는 사실 자체가 거짓 안심이 된다.
 *
 * (2) **어휘 삼중 드리프트.** 같은 상태 집합이 세 곳에 있다 — 마이그레이션의
 *     CHECK, 도메인 상수, 계약의 enum. 두 곳만 고치면 INSERT가 23514로
 *     떨어지거나 계약이 실제로 못 만드는 값을 약속한다. 그래서 여기서는
 *     **마이그레이션 SQL 원문을 읽어** 세 곳을 한 번에 맞춘다.
 */

const CONTRACT = ['contracts', 'openapi', 'une-platform-api-v1.yaml'] as const;
const MIGRATIONS_DIR = repoPath('database', 'migrations');

interface Schema {
  type?: string | string[];
  enum?: string[];
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean;
  items?: Schema;
  $ref?: string;
  pattern?: string;
  minProperties?: number;
}

const doc = loadYaml(...CONTRACT) as {
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components: { schemas: Record<string, Schema> };
};
const schemas = doc.components.schemas;

const operations = new Map<string, Record<string, unknown> & { __path: string }>();
for (const [path, methods] of Object.entries(doc.paths)) {
  for (const operation of Object.values(methods)) {
    if (typeof operation !== 'object' || operation === null) continue;
    const id = (operation as Record<string, unknown>)['x-une-api-id'];
    if (typeof id === 'string') {
      operations.set(id, { ...(operation as Record<string, unknown>), __path: path });
    }
  }
}

/**
 * `CHECK (col IN ('A', 'B'))`에서 값들을 뽑는다.
 *
 * **제약을 마지막으로 정의한 마이그레이션**을 찾아 읽는다. 처음에는 0023
 * 한 파일만 읽었는데, 0025가 `ck_situation_fact_status`에 `SUPERSEDED`를
 * 더했을 때 게이트가 그 사실을 보지 못하고 초록으로 통과했다 — 삼중 대조가
 * 정확히 그 변경에서 뚫렸다(아키텍처 리뷰 B-2). 어휘를 넓히는 마이그레이션이
 * 나중에 또 올 것이므로 한 파일에 고정하지 않는다.
 */
const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR)
  .filter((name) => /^\d{4}_.*\.sql$/.test(name))
  .sort();

function checkValues(constraint: string): string[] {
  const defining = [...MIGRATION_FILES]
    .reverse()
    .find((name) =>
      readFileSync(join(MIGRATIONS_DIR, name), 'utf8').includes(`ADD CONSTRAINT ${constraint}`),
    );
  if (!defining) throw new Error(`제약 ${constraint}을 어느 마이그레이션에서도 찾지 못했다`);
  const sql = readFileSync(join(MIGRATIONS_DIR, defining), 'utf8');
  const anchor = sql.lastIndexOf(`ADD CONSTRAINT ${constraint}`);
  const slice = sql.slice(anchor, anchor + 800);
  const open = slice.indexOf('IN (');
  const close = slice.indexOf(')', open);
  if (open < 0 || close < 0) {
    throw new Error(`제약 ${constraint}의 IN 목록을 읽지 못했다(${defining})`);
  }
  return [...slice.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** 구현된 SIT API 목록 — 컨트롤러 주석에서 유도한다. 손으로 관리하는 목록은
 * 낡는다(file-upload 게이트와 같은 방식). */
const implementedSitApis = new Set(
  [
    ...readFileSync(
      repoPath('services', 'api', 'src', 'situation', 'situation.controller.ts'),
      'utf8',
    ).matchAll(/UNE-SIT-\d{3}/g),
  ].map((m) => m[0]),
);

function responseSchemaRef(apiId: string, status: string): string {
  const operation = operations.get(apiId);
  if (!operation) throw new Error(`${apiId}가 계약에 없다`);
  const responses = operation.responses as Record<string, Record<string, unknown>>;
  const content = responses[status]?.content as Record<string, { schema: Schema }> | undefined;
  const ref = content?.['application/json']?.schema?.$ref;
  if (!ref) throw new Error(`${apiId} ${status} 응답에 스키마 $ref가 없다`);
  return ref;
}

describe('CC-200 계약: 자리표시자가 실형태로 바뀌었다', () => {
  it('Situation은 더 이상 무엇이든 통과시키지 않는다', () => {
    const situation = schemas.Situation;
    // `.not.toBe(true)`로는 부족하다 — 키가 **없는** 상태도 그 단언을 통과하고
    // JSON Schema 기본값은 열림이다(리뷰 m-8). 명시적으로 닫혔는지 본다.
    expect(situation.additionalProperties).toBe(false);
    expect(situation.type).toBe('object');
    expect(situation.required).toEqual(
      expect.arrayContaining([
        'situationId',
        'tenantId',
        'mode',
        'title',
        'hazardType',
        'status',
        'versionNo',
        'createdAt',
        'updatedAt',
      ]),
    );
  });

  it('SituationFact와 ProviderJob도 실형태다', () => {
    for (const name of [
      'SituationFact',
      'SituationFactSource',
      'FactNormalization',
      'ProviderJob',
      'ProviderQueryJob',
      'SituationDetail',
    ]) {
      expect(schemas[name], `${name} 누락`).toBeDefined();
      expect(schemas[name].additionalProperties, `${name}이 열려 있다`).toBe(false);
      expect((schemas[name].required ?? []).length, `${name}에 필수 필드가 없다`).toBeGreaterThan(
        0,
      );
    }
  });

  it('SituationSnapshot도 CC-210에서 채워졌다 — 상황 계열에 자리표시자가 남지 않았다', () => {
    // CC-200은 "확정 경로를 쥔 CC-210이 채운다"며 의도적으로 남겼고, 그 항목이
    // 이것이다. 이제 상황 계열 응답 스키마에 열린 것이 하나도 없어야 한다.
    for (const name of [
      'SituationSnapshot',
      'SnapshotFact',
      'DuplicateGroup',
      'FactConflict',
      'ConflictResolution',
      'SnapshotDiff',
    ]) {
      expect(schemas[name], `${name} 누락`).toBeDefined();
      expect(schemas[name].additionalProperties, `${name}이 열려 있다`).toBe(false);
    }
  });
});

describe('CC-200 계약: 어휘가 마이그레이션·도메인과 같다', () => {
  it('상황 상태 8종이 세 곳에서 같다', () => {
    const fromDb = checkValues('ck_situation_status');
    expect(schemas.SituationStatus.enum).toEqual(fromDb);
    expect([...SITUATION_STATUSES]).toEqual(fromDb);
  });

  it('mode 2종이 세 곳에서 같다', () => {
    const fromDb = checkValues('ck_situation_mode');
    expect(schemas.SituationMode.enum).toEqual(fromDb);
    expect([...SITUATION_MODES]).toEqual(fromDb);
  });

  it('Fact 상태 3종이 세 곳에서 같다', () => {
    const fromDb = checkValues('ck_situation_fact_status');
    // 0025가 SUPERSEDED를 더했다 — 세 곳이 함께 넓어졌는지 본다.
    expect(schemas.SituationFactStatus.enum).toEqual(fromDb);
    expect([...FACT_STATUSES]).toEqual(fromDb);
  });

  it('Provider 코드 7종이 세 곳에서 같다', () => {
    const fromDb = checkValues('ck_fact_source_provider_code');
    expect(schemas.ProviderCode.enum).toEqual(fromDb);
    expect([...PROVIDER_CODES]).toEqual(fromDb);
    // provider_job 쪽 CHECK도 같은 목록이어야 한다.
    expect(checkValues('ck_provider_job_provider_code')).toEqual(fromDb);
  });

  it('provider_job 상태 5종이 계약과 같다 (0028이 비동기를 열었다 — ADR-36 D3)', () => {
    // CC-200 착수 시점의 단언은 3종이었고 근거는 "수집은 동기다"(ADR-33 D2)였다.
    // 그 근거는 상황 수집에 대해 **여전히 참이다** — 수집 경로는 종결 상태로만
    // 행을 만든다. 늘어난 두 값은 CC-220의 UNI 지식문서 전송이 쓴다.
    //
    // 이 변경은 0023 §4가 예고한 것이다: "QUEUED/RUNNING을 넣지 않는 이유가
    // 이것이다 … 비동기로 옮길 때 그 두 값을 추가하는 마이그레이션이 함께 온다."
    const fromDb = checkValues('ck_provider_job_status');
    expect(fromDb).toEqual(['QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED']);
    expect((schemas.ProviderJob.properties?.status.enum ?? []).sort()).toEqual([...fromDb].sort());
  });

  it('Fact 범주 6종이 설계 01 §20.5와 같고 도메인과 일치한다', () => {
    const designCategories = [
      'WEATHER_OBSERVATION',
      'WEATHER_FORECAST',
      'WEATHER_WARNING',
      'DISASTER_MESSAGE',
      'FIELD_REPORT',
      'USER_ASSERTED',
    ];
    expect(schemas.SituationFactType.enum).toEqual(designCategories);
    expect([...FACT_TYPES]).toEqual(designCategories);
  });

  it('factKey 패턴이 situation-fact.schema.json과 같다', () => {
    const jsonSchema = JSON.parse(
      readFileSync(repoPath('contracts', 'schemas', 'situation-fact.schema.json'), 'utf8'),
    ) as { properties: { factKey: { pattern: string } } };
    expect(schemas.SituationFact.properties?.factKey.pattern).toBe(
      jsonSchema.properties.factKey.pattern,
    );
  });
});

describe('CC-200 계약: 응답 형태가 설계 10 표와 맞다', () => {
  it('SIT-002는 단건이 아니라 Page다', () => {
    // 자리표시자 시절 SIT-002는 단건 Situation을 가리키고 있었다.
    expect(responseSchemaRef('UNE-SIT-002', '200')).toMatch(/SituationPageResponse$/);
  });

  it('SIT-003은 SituationDetail이다', () => {
    expect(responseSchemaRef('UNE-SIT-003', '200')).toMatch(/SituationDetailResponse$/);
  });

  it('SIT-005는 ProviderQueryJob이고 200이다', () => {
    expect(responseSchemaRef('UNE-SIT-005', '200')).toMatch(/ProviderQueryJobResponse$/);
  });

  it('SIT-007/008은 SituationFact다', () => {
    expect(responseSchemaRef('UNE-SIT-007', '201')).toMatch(/SituationFactResponse$/);
    expect(responseSchemaRef('UNE-SIT-008', '200')).toMatch(/SituationFactResponse$/);
  });
});

describe('CC-200 계약: 요청이 GenericRequest가 아니다', () => {
  it('SIT-004/007/008이 전용 스키마를 쓰고 알 수 없는 항목을 막는다', () => {
    const cases: [string, string][] = [
      // SIT-001은 자리표시자가 아니었지만 `additionalProperties`가 열려 있어
      // **계약이 허용하는 요청을 구현이 400으로 막고 있었다**(리뷰 M-5).
      ['UNE-SIT-001', 'SituationCreateRequest'],
      ['UNE-SIT-004', 'SituationPatchRequest'],
      ['UNE-SIT-005', 'ProviderQueryRequest'],
      ['UNE-SIT-007', 'SituationFactCreateRequest'],
      ['UNE-SIT-008', 'SituationFactPatchRequest'],
    ];
    for (const [apiId, schemaName] of cases) {
      const operation = operations.get(apiId);
      const body = operation?.requestBody as {
        required: boolean;
        content: Record<string, { schema: Schema }>;
      };
      expect(body.required, `${apiId} requestBody가 선택이다`).toBe(true);
      expect(body.content['application/json'].schema.$ref).toMatch(new RegExp(`${schemaName}$`));
      expect(schemas[schemaName].additionalProperties, `${schemaName}이 열려 있다`).toBe(false);
    }
  });

  it('빈 PATCH 본문을 계약에서 막는다', () => {
    expect(schemas.SituationPatchRequest.minProperties).toBe(1);
    // Fact 보정은 사유가 필수이므로 사유 + 바꿀 항목 하나 = 최소 2다(ADR-34 D3).
    expect(schemas.SituationFactPatchRequest.minProperties).toBe(2);
    expect(schemas.SituationFactPatchRequest.required).toContain('reason');
  });

  it('수동 Fact 등록 요청은 providerCode를 받지 않는다 (사칭 차단)', () => {
    const source = schemas.SituationFactCreateRequest.properties?.source;
    expect(Object.keys(source?.properties ?? {})).toEqual(['sourceName', 'sourceUrl']);
  });
});

describe('CC-200 계약: 구현이 던지는 오류코드가 x-error-codes에 선언돼 있다', () => {
  // QA 리뷰 F-3: PROV-503-001 → PROV-400-001, FACT-422-001(400) → FACT-400-001
  // 재명명이 **테스트 0건 실패로 통과했다.** 어떤 테스트도 SIT 계열 400 코드를
  // 단언하지 않았기 때문이다. CC-150이 change-set 계약에 세운 게이트와 같은
  // 것을 여기 세운다 — 구현 소스에서 코드를 뽑아 계약과 대조한다.
  const SOURCE = repoPath('services', 'api', 'src', 'situation', 'situation-errors.ts');

  it('situation-errors.ts가 만드는 코드가 모두 계약에 선언돼 있다', () => {
    const source = readFileSync(SOURCE, 'utf8');
    const emitted = new Set(
      [...source.matchAll(/new ApiError\(\s*\d{3},\s*'([A-Z]+-[0-9-]+)'/g)].map((m) => m[1]),
    );
    // 유도가 깨지면 통과가 아니라 게이트 고장이다.
    expect(emitted.size).toBeGreaterThanOrEqual(10);

    const declared = new Set<string>();
    for (const [id, operation] of operations) {
      if (!implementedSitApis.has(id)) continue;
      for (const code of (operation['x-error-codes'] as string[] | undefined) ?? []) {
        declared.add(code);
      }
    }
    const missing = [...emitted].filter((code) => !declared.has(code));
    expect(missing, '구현이 던지는데 계약이 모르는 코드').toEqual([]);
  });

  it('경로 파라미터가 있는 **구현된** SIT API는 COM-0400을 선언한다', () => {
    // 잘못된 UUID는 404가 아니라 400 COM-0400이다(controller-utils.uuidParam).
    // 미구현 API(SIT-006 SSE, SIT-009~013 CC-210)는 대상이 아니다 — 구현 목록은
    // 컨트롤러 주석에서 유도한다(file-upload 게이트와 같은 방식).
    // CC-200의 9 + CC-210의 SIT-009~013 다섯 = 14.
    expect(implementedSitApis.size).toBe(14);
    for (const [id, operation] of operations) {
      if (!implementedSitApis.has(id)) continue;
      if (!String(operation.__path).includes('{')) continue;
      expect(
        (operation['x-error-codes'] as string[] | undefined) ?? [],
        `${id}(${String(operation.__path)})가 COM-0400을 선언하지 않는다`,
      ).toContain('COM-0400');
    }
  });

  it('멱등 대상 SIT API는 COM-0409를 선언한다', () => {
    for (const id of ['UNE-SIT-001', 'UNE-SIT-004', 'UNE-SIT-005', 'UNE-SIT-007', 'UNE-SIT-008']) {
      expect(
        (operations.get(id)?.['x-error-codes'] as string[] | undefined) ?? [],
        `${id}가 COM-0409를 선언하지 않는다`,
      ).toContain('COM-0409');
    }
  });
});

describe('CC-200 계약: 오류코드가 실제로 반환하는 것만 적힌다 (ADR-33 D17)', () => {
  it('400 경로는 400 코드를 쓴다', () => {
    expect(operations.get('UNE-SIT-005')?.['x-error-codes']).toContain('PROV-400-001');
    expect(operations.get('UNE-SIT-007')?.['x-error-codes']).toContain('FACT-400-001');
    expect(operations.get('UNE-SIT-008')?.['x-error-codes']).toContain('FACT-400-001');
  });

  it('PROV-503-001은 어디에도 선언되지 않는다 (D11 때문에 반환되지 않는다)', () => {
    // 설계 10 오류표는 "상황 Provider 장애 / 부분결과·수동"으로 정의하지만,
    // Provider 장애는 200 + jobs[].status=FAILED다. 반환하지 않는 코드를
    // 남겨 두면 x-error-codes가 검증 가능한 사실이 아니게 된다.
    for (const [id, operation] of operations) {
      if (!id.startsWith('UNE-SIT-')) continue;
      expect(
        (operation['x-error-codes'] as string[] | undefined) ?? [],
        `${id}가 반환하지 않는 코드를 선언한다`,
      ).not.toContain('PROV-503-001');
    }
  });

  it('422(정규화 격리)와 400(요청 형식)이 같은 코드를 쓰지 않는다', () => {
    const sit007 = (operations.get('UNE-SIT-007')?.['x-error-codes'] as string[]) ?? [];
    expect(sit007).toContain('FACT-422-001');
    expect(sit007).toContain('FACT-400-001');
  });
});

describe('CC-200 계약: 목업 훅이 운영 계약에 남아 있지 않다 (ADR-33 D19)', () => {
  it('ProviderQueryRequest.query 설명이 mockScenario를 약속하지 않는다', () => {
    const description = String(
      (schemas.ProviderQueryRequest.properties?.query as { description?: string } | undefined)
        ?.description ?? '',
    );
    expect(description).not.toContain('mockScenario');
  });
});

describe('CC-200 계약: 신설 API 두 건 (ADR-33 D7)', () => {
  it('SIT-014 후보 Fact 목록이 있다', () => {
    const operation = operations.get('UNE-SIT-014');
    expect(operation, 'UNE-SIT-014가 계약에 없다').toBeDefined();
    expect(operation?.__path).toBe('/situations/{id}/facts');
    expect(operation?.['x-permission']).toBe('SITUATION_READ');
    expect(responseSchemaRef('UNE-SIT-014', '200')).toMatch(/SituationFactPageResponse$/);
  });

  it('SIT-015 Provider Job 상태가 있다', () => {
    const operation = operations.get('UNE-SIT-015');
    expect(operation, 'UNE-SIT-015가 계약에 없다').toBeDefined();
    expect(operation?.__path).toBe('/provider-jobs/{jobId}');
    expect(operation?.['x-db-tables']).toEqual(['provider_job']);
  });

  it('SSE(SIT-006)는 계약에 남아 있다 (폴링은 대체이지 삭제가 아니다)', () => {
    // 비동기로 옮길 때 여는 자리다. 지우면 그 사실이 사라진다(ADR-33 수용 한계 1).
    expect(operations.get('UNE-SIT-006')).toBeDefined();
  });
});
