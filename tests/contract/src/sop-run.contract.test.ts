import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RUN_EVENT_TYPES, SOP_RUN_MODES, SOP_RUN_STATUSES, TASK_STATUSES } from '@une/domain';
import { loadYaml, repoPath } from './contract-loader';

/**
 * CC-260 계약 게이트 — 실행·임무 어휘가 마이그레이션·도메인·계약에서 같은가.
 *
 * CC-240/250 게이트와 같은 규칙. 오류코드는 **정의가 아니라 호출부**를 본다.
 */
const MIGRATIONS_DIR = repoPath('database', 'migrations');

interface Schema {
  enum?: string[];
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean;
  items?: Schema;
  $ref?: string;
}

const doc = loadYaml('contracts', 'openapi', 'une-platform-api-v1.yaml') as {
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components: { schemas: Record<string, Schema> };
};
const schemas = doc.components.schemas;

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

const RUN_OPS = [
  'UNE-SOP-010',
  'UNE-SOP-011',
  'UNE-SOP-012',
  'UNE-SOP-013',
  'UNE-SOP-014',
  'UNE-SOP-015',
  'UNE-SOP-016',
] as const;

describe('CC-260 계약: 어휘가 세 곳에서 같다', () => {
  it('실행 상태 4종 — COMPLETED/FAILED는 아직 없다', () => {
    const fromDb = checkValues('ck_sop_run_status');
    expect(fromDb).toEqual([...SOP_RUN_STATUSES]);
    expect(schemas.SopRun.properties?.status.enum).toEqual(fromDb);
    // 완료 보고 경로(CC-280)가 없는데 어휘만 넣지 않는다(0022 §1).
    expect(fromDb).not.toContain('COMPLETED');
    expect(fromDb).not.toContain('FAILED');
  });

  it('실행 방식 3종', () => {
    const fromDb = checkValues('ck_sop_run_mode');
    expect(fromDb).toEqual([...SOP_RUN_MODES]);
    expect(schemas.SopRun.properties?.mode.enum).toEqual(fromDb);
    expect(schemas.SopRunCreateRequest.properties?.mode.enum).toEqual(fromDb);
  });

  it('임무 상태 2종 — 전파·수행 상태는 아직 없다', () => {
    const fromDb = checkValues('ck_task_status');
    expect(fromDb).toEqual([...TASK_STATUSES]);
    expect(schemas.Task.properties?.status.enum).toEqual(fromDb);
    for (const later of ['SENT', 'DELIVERED', 'ACKNOWLEDGED', 'COMPLETED']) {
      expect(fromDb, later).not.toContain(later);
    }
  });

  it('SSE 설명이 실제 이벤트 어휘를 적는다', () => {
    const description = String(
      (operations.get('UNE-SOP-013')?.responses as Record<string, { description?: string }>)['200']
        ?.description ?? '',
    );
    for (const type of RUN_EVENT_TYPES) {
      expect(description, type).toContain(type);
    }
  });
});

describe('CC-260 계약: 오류코드 선언이 사실이다', () => {
  const errorSource = readFileSync(
    repoPath('services', 'api', 'src', 'sop', 'sop-run-errors.ts'),
    'utf8',
  );
  const callers = [
    readFileSync(repoPath('services', 'api', 'src', 'sop', 'sop-run.service.ts'), 'utf8'),
    readFileSync(repoPath('services', 'api', 'src', 'sop', 'sop-run.controller.ts'), 'utf8'),
  ].join('\n');
  const defined = [...errorSource.matchAll(/ApiError\(\s*\d{3},\s*'([A-Z0-9-]+)'/g)].map(
    (m) => m[1],
  );

  it('정의만 있고 아무도 부르지 않는 코드가 없다', () => {
    const names = [...errorSource.matchAll(/^ {2}([a-zA-Z]+): \(/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(
        callers.includes(`sopRunErrors.${name}(`),
        `sopRunErrors.${name}를 아무도 부르지 않는다`,
      ).toBe(true);
    }
  });

  it('구현이 던지는 코드는 모두 어느 실행 오퍼레이션엔가 선언돼 있다', () => {
    const declared = new Set<string>();
    for (const id of RUN_OPS) {
      for (const code of (operations.get(id)?.['x-error-codes'] as string[] | undefined) ?? []) {
        declared.add(code);
      }
    }
    for (const code of defined) {
      expect(declared.has(code), `${code}가 계약에 선언되지 않았다`).toBe(true);
    }
  });

  it('계약이 선언한 코드는 모두 구현이 던진다 (ADR-33 D17)', () => {
    for (const id of RUN_OPS) {
      for (const code of (operations.get(id)?.['x-error-codes'] as string[] | undefined) ?? []) {
        if (code.startsWith('COM-')) continue;
        // SOP-503-001은 SSE 장애 표시이며 HTTP 오류가 아니다 — 설명이 그렇게 적는다.
        if (code === 'SOP-503-001') continue;
        expect(defined.includes(code), `${id}이 선언한 ${code}를 구현이 던지지 않는다`).toBe(true);
      }
    }
  });
});

describe('CC-260 계약: 응답 모양이 자리표시자가 아니다', () => {
  it('일곱 오퍼레이션 모두 열린 스키마를 쓰지 않는다', () => {
    // 착수 시점 `SopRun`/`Task`가 `additionalProperties: true`였다.
    expect(schemas.SopRun.additionalProperties).toBe(false);
    expect(schemas.Task.additionalProperties).toBe(false);
    expect(schemas.SopRunDetail.additionalProperties).toBe(false);
  });

  it('요청 스키마는 알 수 없는 필드를 받지 않는다', () => {
    for (const name of ['SopSimulationRequest', 'SopRunControlRequest', 'SopRunTerminateRequest']) {
      expect(schemas[name]?.additionalProperties, name).toBe(false);
    }
  });

  it('강제종료는 확인코드를 요구한다', () => {
    // 되돌릴 수 없는 조작이라 실수로 눌리면 안 된다.
    expect(schemas.SopRunTerminateRequest.required).toContain('confirmCode');
  });

  it('시작은 201, 통제는 200이다', () => {
    const codes = (id: string): string[] => Object.keys(operations.get(id)?.responses as object);
    expect(codes('UNE-SOP-010')).toContain('201');
    expect(codes('UNE-SOP-011')).toContain('201');
    expect(codes('UNE-SOP-014')).toContain('200');
    expect(codes('UNE-SOP-016')).toContain('200');
  });

  it('권한이 설계 표와 같다', () => {
    const perms: Record<string, string> = {
      'UNE-SOP-010': 'SOP_RUN',
      'UNE-SOP-011': 'SOP_RUN',
      'UNE-SOP-012': 'SOP_READ',
      'UNE-SOP-013': 'SOP_READ',
      'UNE-SOP-014': 'SOP_RUN_CONTROL',
      'UNE-SOP-015': 'SOP_RUN_CONTROL',
      'UNE-SOP-016': 'SOP_RUN_CONTROL',
    };
    for (const [id, permission] of Object.entries(perms)) {
      expect(operations.get(id)?.['x-permission'], id).toBe(permission);
    }
  });
});

describe('CC-260 계약: 실행 불변성이 DB에 있다', () => {
  const sql = readFileSync(join(MIGRATIONS_DIR, '0036_sop_run_and_task_state.sql'), 'utf8');

  it('사실원장과 임무 이벤트가 append-only다', () => {
    // 권한만으로는 부족하다 — superuser 연결에서 UPDATE가 그대로 통과했다(실측).
    expect(sql).toContain('trg_execution_event_append_only');
    expect(sql).toContain('trg_task_event_append_only');
  });

  it('종료된 실행의 임무는 DB가 막는다', () => {
    expect(sql).toContain('trg_task_run_terminated');
  });

  it('세 테이블 모두 같은 마이그레이션에서 정책을 받는다', () => {
    for (const table of ['sop_run', 'task', 'task_event']) {
      expect(sql, table).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql, table).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      expect(sql, table).toContain(`CREATE POLICY p_${table}_tenant ON ${table}`);
    }
  });
});
