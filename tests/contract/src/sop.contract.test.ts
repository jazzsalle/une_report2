import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PUBLIC_JOB_EVENT_TYPES,
  SOP_GRAPH_SCHEMA_VERSIONS,
  SOP_GRAPH_VIOLATIONS,
  SOP_MAPPING_WARNINGS,
  SOP_NODE_KEY_PATTERN,
  SOP_NODE_TYPES,
} from '@une/domain';
import { mapUniCompn } from '@une/provider-adapters';
import { loadJson, loadYaml, repoPath } from './contract-loader';

/**
 * CC-240 계약 게이트 — SOP 어휘가 마이그레이션·도메인·계약·JSON Schema 네 곳에서
 * 같은가.
 *
 * CC-200/CC-220이 이 게이트를 만든 이유가 그대로다. CC-240은 어휘를 **세 개**
 * 새로 만들었다(노드 유형·매핑 경고·그래프 위반) 그리고 SSE 이벤트 어휘를
 * 둘 늘렸다. 게다가 여기에는 다른 항목에 없던 것이 하나 더 있다 —
 * `contracts/schemas/sop-graph.schema.json`이 **노드 키 형식을 못박고 있다.**
 * 매퍼가 그것을 어기면 저장은 되고 나중에 내보내기가 깨진다.
 */
const CONTRACT = ['contracts', 'openapi', 'une-platform-api-v1.yaml'] as const;
const MIGRATIONS_DIR = repoPath('database', 'migrations');

interface Schema {
  type?: string | string[];
  enum?: string[];
  const?: string;
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean;
  pattern?: string;
  items?: Schema;
  $defs?: Record<string, Schema>;
  $ref?: string;
}

const doc = loadYaml(...CONTRACT) as {
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components: { schemas: Record<string, Schema> };
};
const schemas = doc.components.schemas;
const graphSchema = loadJson('contracts', 'schemas', 'sop-graph.schema.json') as Schema;

const operations = new Map<string, Record<string, unknown>>();
for (const methods of Object.values(doc.paths)) {
  for (const operation of Object.values(methods)) {
    if (typeof operation !== 'object' || operation === null) continue;
    const id = (operation as Record<string, unknown>)['x-une-api-id'];
    if (typeof id === 'string') operations.set(id, operation as Record<string, unknown>);
  }
}

const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR)
  .filter((name) => /^\d{4}_.*\.sql$/.test(name))
  .sort();

/** 제약을 **마지막으로 정의한** 마이그레이션에서 읽는다(CC-220 게이트와 같은 규칙). */
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
  const inIdx = slice.indexOf(' IN');
  const open = inIdx < 0 ? -1 : slice.indexOf('(', inIdx);
  const close = open < 0 ? -1 : slice.indexOf(')', open);
  if (open < 0 || close < 0) throw new Error(`제약 ${constraint}의 IN 목록을 읽지 못했다`);
  return [...slice.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const SOP_OPS = ['UNE-SOP-001', 'UNE-SOP-002', 'UNE-SOP-017'] as const;

describe('CC-240 계약: 어휘가 네 곳에서 같다', () => {
  it('노드 유형 5종 — 마이그레이션·도메인·JSON Schema', () => {
    const fromDb = checkValues('ck_sop_node_type');
    expect(fromDb).toEqual([...SOP_NODE_TYPES]);
    expect(graphSchema.$defs?.node.properties?.nodeType.enum).toEqual(fromDb);
  });

  it('버전 상태는 도달 가능한 것만이다 (0022 §1)', () => {
    // CC-240이 만드는 것은 DRAFT뿐이다. LOCKED/APPROVED를 지금 넣으면 그 값을
    // 쓰는 코드가 없는 채로 어휘만 남는다 — CC-250이 넓힌다.
    expect(checkValues('ck_sop_version_status')).toEqual(['DRAFT']);
    expect(checkValues('ck_sop_status')).toEqual(['DRAFT']);
  });

  it('요청 스키마 버전은 JSON Schema의 그래프 버전과 같다', () => {
    expect(schemas.SopGenerationRequest.properties?.schemaVersion.enum).toEqual([
      ...SOP_GRAPH_SCHEMA_VERSIONS,
    ]);
    expect(graphSchema.properties?.schemaVersion.const).toBe(SOP_GRAPH_SCHEMA_VERSIONS[0]);
  });

  it('SSE 설명이 실제 공개 이벤트 어휘를 적는다', () => {
    const description = String(
      (operations.get('UNE-SOP-002')?.responses as Record<string, { description?: string }>)['200']
        ?.description ?? '',
    );
    for (const type of ['job.queued', 'job.started', 'sop.node', 'sop.sources', 'job.completed']) {
      expect(description, type).toContain(type);
      expect(PUBLIC_JOB_EVENT_TYPES as readonly string[]).toContain(type);
    }
    // 내부 추적 이벤트는 스트림 어휘에 없어야 한다 — provider 원문이 클라이언트로
    // 나가면 그 순간부터 UNI 응답 모양이 UNE의 공개 계약이 된다.
    for (const internal of ['provider.requested', 'provider.responded', 'provider.failed']) {
      expect(description, internal).not.toContain(internal);
    }
  });

  it('SSE 설명이 매핑 경고와 그래프 위반 어휘를 빠짐없이 적는다', () => {
    const description = String(
      (operations.get('UNE-SOP-002')?.responses as Record<string, { description?: string }>)['200']
        ?.description ?? '',
    );
    for (const warning of SOP_MAPPING_WARNINGS) {
      // NODE_KEY_NORMALIZED만 예외로 두지 않는다 — 화면이 "왜 키가 다른가"에
      // 답하려면 이 경고를 알아야 한다.
      expect(description, warning).toContain(warning);
    }
    for (const violation of SOP_GRAPH_VIOLATIONS) {
      expect(description, violation).toContain(violation);
    }
  });
});

describe('CC-240 계약: 매퍼 출력이 그래프 스키마를 만족한다', () => {
  // 매퍼는 어댑터 패키지에 있다(ADR-38 D18) — provider 필드명을 아는 코드가
  // 도메인에 있으면 의존 방향이 뒤집힌다. 게이트가 보는 것은 위치가 아니라
  // **출력이 계약을 만족하는가**이므로 검사 내용은 그대로다.
  const keyPattern = graphSchema.$defs?.node.properties?.nodeKey.pattern;

  it('JSON Schema와 도메인이 같은 노드 키 규칙을 쓴다', () => {
    // 두 곳에 적힌 정규식이 갈라지면, 도메인은 통과시키고 내보내기가 거부하는
    // 그래프가 생긴다.
    expect(keyPattern).toBe(SOP_NODE_KEY_PATTERN.source);
  });

  it('UNI가 어떤 compnSn을 주든 매퍼 결과는 규칙을 만족한다', () => {
    const re = new RegExp(keyPattern as string);
    for (const raw of ['C1', '3', '대피 단계', '!!!', 'a', '-x-', 'A'.repeat(200)]) {
      const m = mapUniCompn({ compnSn: raw, type: 'ACTION' }, 5);
      expect(m.ok, raw).toBe(true);
      if (!m.ok) continue;
      expect(m.value.node.nodeKey, raw).toMatch(re);
      // 원본은 사라지지 않는다 — UNI 응답과 우리 그래프를 이을 유일한 끈이다.
      expect(m.value.node.providerNodeKey, raw).toBe(raw);
    }
  });

  it('노드 키 길이가 DB 컬럼(varchar(80))을 넘지 않는다', () => {
    const m = mapUniCompn({ compnSn: 'A'.repeat(500), type: 'ACTION' }, 1);
    expect(m.ok && m.value.node.nodeKey.length).toBeLessThanOrEqual(80);
  });
});

describe('CC-240 계약: 오류코드 선언이 사실이다', () => {
  const apiSource = readFileSync(
    repoPath('services', 'api', 'src', 'sop', 'sop-errors.ts'),
    'utf8',
  );
  // **워커도 오류 코드를 낸다.** SOP 생성은 비동기이므로 UNI 실패는 HTTP
  // 응답이 아니라 `job.failed` 프레임의 payload 코드로 도착한다 — SSE는 이미
  // 200으로 열려 있다. API 파일만 읽으면 `UNI-503-003`이 "선언만 되고 아무도
  // 던지지 않는 코드"처럼 보이는데, 사실이 아니다(CC-240 게이트 실측).
  const workerSource = readFileSync(
    repoPath('services', 'worker', 'src', 'sop', 'sop-job.runner.ts'),
    'utf8',
  );
  // SOP 표면이 공용 잡 서비스를 거쳐 던지는 코드(JOB-404-001 등)도 사실이다.
  const sharedSource = readFileSync(
    repoPath('services', 'api', 'src', 'plan', 'toc-errors.ts'),
    'utf8',
  );
  const definedInApi = [...apiSource.matchAll(/ApiError\(\s*\d{3},\s*'([A-Z0-9-]+)'/g)].map(
    (m) => m[1],
  );
  const thrown = new Set([
    ...definedInApi,
    ...[...sharedSource.matchAll(/ApiError\(\s*\d{3},\s*'([A-Z0-9-]+)'/g)].map((m) => m[1]),
    ...[...workerSource.matchAll(/code: '([A-Z]{2,}-\d{3}-\d{3})'/g)].map((m) => m[1]),
  ]);

  it('sop-errors.ts에 정의만 있고 아무도 부르지 않는 코드가 없다', () => {
    // **정의가 아니라 호출을 본다.** 정의만 세면 죽은 코드가 게이트를
    // 통과시킨다 — CC-240에서 `SOP-404-002`가 정확히 그랬다(QA F4). 그 코드는
    // 아무도 던지지 않는데 계약에 선언돼 있었고, 게이트는 초록이었다.
    const callers = [
      readFileSync(repoPath('services', 'api', 'src', 'sop', 'sop-job.service.ts'), 'utf8'),
      readFileSync(repoPath('services', 'api', 'src', 'sop', 'sop-job.controller.ts'), 'utf8'),
    ].join('\n');
    const names = [...apiSource.matchAll(/^\s{2}([a-zA-Z]+): \(/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(
        callers.includes(`sopErrors.${name}(`),
        `sopErrors.${name}를 아무도 부르지 않는다`,
      ).toBe(true);
    }
  });

  it('구현이 던지는 코드는 모두 어느 SOP 오퍼레이션엔가 선언돼 있다', () => {
    const declared = new Set<string>();
    for (const id of SOP_OPS) {
      for (const code of (operations.get(id)?.['x-error-codes'] as string[] | undefined) ?? []) {
        declared.add(code);
      }
    }
    // `sop-errors.ts`가 정의한 것은 전부 SOP 오퍼레이션이 선언해야 한다.
    // 공용 파일(`toc-errors.ts`)의 코드는 계획서 오퍼레이션의 것이기도 하므로
    // 여기서 전수 대조하지 않는다 — 반대 방향(선언 → 구현)이 그것을 덮는다.
    for (const code of definedInApi) {
      expect(declared.has(code), `${code}가 계약에 선언되지 않았다`).toBe(true);
    }
  });

  it('계약이 선언한 코드는 모두 구현이 던진다 (ADR-33 D17)', () => {
    for (const id of SOP_OPS) {
      for (const code of (operations.get(id)?.['x-error-codes'] as string[] | undefined) ?? []) {
        if (code.startsWith('COM-')) continue; // 인터셉터·경로검증이 던진다
        expect(thrown.has(code), `${id}이 선언한 ${code}를 구현이 던지지 않는다`).toBe(true);
      }
    }
  });

  it('멱등 필수 오퍼레이션은 COM-0400과 COM-0409를 선언한다', () => {
    const declared = (operations.get('UNE-SOP-001')?.['x-error-codes'] as string[]) ?? [];
    expect(declared).toContain('COM-0400');
    expect(declared).toContain('COM-0409');
  });
});

describe('CC-240 계약: SOP 생성 Job 취소 (UNE-SOP-017)', () => {
  const op = () => operations.get('UNE-SOP-017') as Record<string, unknown>;

  it('UNE 신설임을 계약이 밝힌다', () => {
    // 설계 10 SOP 표에 없는 오퍼레이션이다. 표시가 없으면 나중에 "설계에
    // 있었나"를 되짚을 수 없다.
    expect(op()['x-une-added']).toBe('CC-240');
    expect(String((op() as { description?: string }).description)).toContain('UNE 신설');
  });

  it('SOP_GENERATE를 요구한다 (PLAN_GENERATE가 아니다)', () => {
    // 이것이 이 오퍼레이션이 존재하는 이유다 — UNE-PLAN-012로 SOP 잡을 끄면
    // SOP 운용자는 자기 잡을 못 끄고 계획서 작성자는 남의 잡을 끈다.
    expect(op()['x-permission']).toBe('SOP_GENERATE');
    expect(operations.get('UNE-PLAN-012')?.['x-permission']).toBe('PLAN_GENERATE');
  });

  it('202이고 멱등키가 필요하다', () => {
    expect(Object.keys(op().responses as object)).toContain('202');
    const declared = (op()['x-error-codes'] as string[]) ?? [];
    expect(declared).toContain('COM-0400');
    expect(declared).toContain('COM-0409');
  });
});

describe('CC-240 계약: 요청·응답 모양', () => {
  it('UNE-SOP-001의 본문은 필수다', () => {
    // 세 필드가 required인데 본문이 optional이면 계약이 스스로 모순이다.
    const body = operations.get('UNE-SOP-001')?.requestBody as { required?: boolean };
    expect(body.required).toBe(true);
    expect(schemas.SopGenerationRequest.required).toEqual([
      'snapshotId',
      'evidenceSetId',
      'schemaVersion',
    ]);
  });

  it('요청 스키마는 알 수 없는 필드를 받지 않는다', () => {
    expect(schemas.SopGenerationRequest.additionalProperties).toBe(false);
  });

  it('UNE-SOP-001은 201이고 412를 선언한다', () => {
    // 201이지만 "생성됨"은 Job이지 SOP가 아니다 — 설명이 그것을 말해야 한다.
    const responses = operations.get('UNE-SOP-001')?.responses as Record<
      string,
      { description?: string }
    >;
    expect(Object.keys(responses)).toContain('201');
    expect(Object.keys(responses)).toContain('412');
    expect(responses['201'].description).toContain('QUEUED');
  });

  it('SOP 생성은 UNI만 쓴다 (플랜 흐름과 섞이지 않는다)', () => {
    // 계획서 흐름에 UNI가 들어가면 안 되는 것과 짝이 되는 규칙이다:
    // SOP 생성에 T3Q가 들어가서도 안 된다.
    const runner = readFileSync(
      repoPath('services', 'worker', 'src', 'sop', 'sop-job.runner.ts'),
      'utf8',
    );
    expect(runner).not.toMatch(/T3q|t3q/);
  });
});
