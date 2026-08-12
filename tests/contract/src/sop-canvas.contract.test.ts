import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SOP_LIFECYCLE_STATUSES,
  SOP_NODE_KEY_PATTERN,
  SOP_NODE_TYPES,
  SOP_TITLE_MAX_LENGTH,
  SOP_VALIDATION_STATUSES,
} from '@une/domain';
import { loadJson, loadYaml, repoPath } from './contract-loader';

/**
 * CC-250 계약 게이트 — 캔버스·검토·승인 어휘가 네 곳에서 같은가.
 *
 * CC-240 게이트와 같은 규칙이고, 거기서 배운 것을 하나 더 얹는다:
 * **오류코드는 정의가 아니라 호출부를 본다.** 정의만 세면 죽은 코드가
 * 게이트를 통과한다 — CC-240에서 `SOP-404-002`가 정확히 그랬다.
 */
const MIGRATIONS_DIR = repoPath('database', 'migrations');

interface Schema {
  type?: string | string[];
  enum?: string[];
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean;
  pattern?: string;
  maxLength?: number;
  items?: Schema;
  $defs?: Record<string, Schema>;
  $ref?: string;
}

const doc = loadYaml('contracts', 'openapi', 'une-platform-api-v1.yaml') as {
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

const CANVAS_OPS = [
  'UNE-SOP-003',
  'UNE-SOP-004',
  'UNE-SOP-005',
  'UNE-SOP-006',
  'UNE-SOP-007',
  'UNE-SOP-008',
  'UNE-SOP-009',
] as const;

describe('CC-250 계약: 어휘가 마이그레이션·도메인·계약에서 같다', () => {
  it('SOP 상태 3종 — RETIRED는 아직 없다', () => {
    const fromDb = checkValues('ck_sop_status');
    expect(fromDb).toEqual([...SOP_LIFECYCLE_STATUSES]);
    expect(schemas.Sop.properties?.status.enum).toEqual(fromDb);
    // 폐기 경로가 없는데 어휘만 넣지 않는다(0022 §1).
    expect(fromDb).not.toContain('RETIRED');
  });

  it('버전 상태 2종 — LOCKED는 승인이 만든다', () => {
    const fromDb = checkValues('ck_sop_version_status');
    expect(fromDb).toEqual(['DRAFT', 'LOCKED']);
    expect(schemas.SopVersion.properties?.status.enum).toEqual(fromDb);
  });

  it('검증 결과 2종', () => {
    const fromDb = checkValues('ck_sop_validation_status');
    expect(fromDb).toEqual([...SOP_VALIDATION_STATUSES]);
    expect(schemas.SopValidationReport.properties?.status.enum).toEqual(fromDb);
  });

  it('검토 상태 2종 — 반려·철회는 아직 없다', () => {
    const fromDb = checkValues('ck_sop_review_request_status');
    expect(fromDb).toEqual(['REQUESTED', 'APPROVED']);
    expect(schemas.ReviewRequest.properties?.status.enum).toEqual(fromDb);
    expect(fromDb).not.toContain('REJECTED');
  });

  it('노드 유형과 키 규칙이 도메인·JSON Schema와 같다', () => {
    expect(schemas.SopGraphNode.properties?.nodeType.enum).toEqual([...SOP_NODE_TYPES]);
    expect(schemas.SopGraphNode.properties?.nodeKey.pattern).toBe(SOP_NODE_KEY_PATTERN.source);
    expect(graphSchema.$defs?.node.properties?.nodeKey.pattern).toBe(SOP_NODE_KEY_PATTERN.source);
    // 제목 상한이 DB 컬럼(varchar 300)과 같아야 22001로 죽지 않는다.
    expect(schemas.SopGraphNode.properties?.title.maxLength).toBe(SOP_TITLE_MAX_LENGTH);
    expect(schemas.Sop.properties?.title.maxLength).toBe(SOP_TITLE_MAX_LENGTH);
  });
});

describe('CC-250 계약: 오류코드 선언이 사실이다', () => {
  const errorSource = readFileSync(
    repoPath('services', 'api', 'src', 'sop', 'sop-canvas-errors.ts'),
    'utf8',
  );
  const callers = [
    readFileSync(repoPath('services', 'api', 'src', 'sop', 'sop.service.ts'), 'utf8'),
    readFileSync(repoPath('services', 'api', 'src', 'sop', 'sop.controller.ts'), 'utf8'),
  ].join('\n');
  const defined = [...errorSource.matchAll(/ApiError\(\s*\d{3},\s*'([A-Z0-9-]+)'/g)].map(
    (m) => m[1],
  );

  it('정의만 있고 아무도 부르지 않는 코드가 없다', () => {
    const names = [...errorSource.matchAll(/^ {2}([a-zA-Z]+): \(/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(
        callers.includes(`sopCanvasErrors.${name}(`),
        `sopCanvasErrors.${name}를 아무도 부르지 않는다`,
      ).toBe(true);
    }
  });

  it('구현이 던지는 코드는 모두 어느 오퍼레이션엔가 선언돼 있다', () => {
    const declared = new Set<string>();
    for (const id of CANVAS_OPS) {
      for (const code of (operations.get(id)?.['x-error-codes'] as string[] | undefined) ?? []) {
        declared.add(code);
      }
    }
    for (const code of defined) {
      expect(declared.has(code), `${code}가 계약에 선언되지 않았다`).toBe(true);
    }
  });

  it('계약이 선언한 코드는 모두 구현이 던진다 (ADR-33 D17)', () => {
    for (const id of CANVAS_OPS) {
      for (const code of (operations.get(id)?.['x-error-codes'] as string[] | undefined) ?? []) {
        if (code.startsWith('COM-')) continue;
        expect(defined.includes(code), `${id}이 선언한 ${code}를 구현이 던지지 않는다`).toBe(true);
      }
    }
  });

  it('상태변경 오퍼레이션은 멱등키 오류를 선언한다', () => {
    for (const id of ['UNE-SOP-003', 'UNE-SOP-006', 'UNE-SOP-008', 'UNE-SOP-009'] as const) {
      const declared = (operations.get(id)?.['x-error-codes'] as string[]) ?? [];
      expect(declared, id).toContain('COM-0400');
      expect(declared, id).toContain('COM-0409');
    }
  });
});

describe('CC-250 계약: 응답 모양이 자리표시자가 아니다', () => {
  it('일곱 오퍼레이션 모두 SopRun 자리표시자를 쓰지 않는다', () => {
    // 착수 시점에는 전부 `SopRun`이었다 — 실행 리소스인데 캔버스·검토·승인의
    // 응답으로 적혀 있었다. CC-220이 `GenericResponse`에서 겪은 것과 같다.
    for (const id of CANVAS_OPS) {
      const body = JSON.stringify(operations.get(id)?.responses);
      expect(body, id).not.toContain('SopRun');
      expect(body, id).not.toContain('GenericResponse');
    }
  });

  it('요청 스키마는 알 수 없는 필드를 받지 않는다', () => {
    for (const name of [
      'SopCreateRequest',
      'SopVersionSaveRequest',
      'SopValidateRequest',
      'SopSubmitReviewRequest',
      'SopApproveRequest',
    ]) {
      expect(schemas[name]?.additionalProperties, name).toBe(false);
    }
  });

  it('저장은 201이고 승인·검증은 200이다', () => {
    const codes = (id: string): string[] => Object.keys(operations.get(id)?.responses as object);
    expect(codes('UNE-SOP-006')).toContain('201'); // 새 버전이 생긴다
    expect(codes('UNE-SOP-008')).toContain('201'); // 검토 요청이 생긴다
    expect(codes('UNE-SOP-009')).toContain('200'); // 기존 버전을 고정한다
    expect(codes('UNE-SOP-007')).toContain('200');
  });

  it('권한이 설계 표와 같다', () => {
    const perms: Record<string, string> = {
      'UNE-SOP-003': 'SOP_EDIT',
      'UNE-SOP-004': 'SOP_READ',
      'UNE-SOP-005': 'SOP_READ',
      'UNE-SOP-006': 'SOP_EDIT',
      'UNE-SOP-007': 'SOP_EDIT',
      'UNE-SOP-008': 'SOP_EDIT',
      'UNE-SOP-009': 'SOP_APPROVE',
    };
    for (const [id, permission] of Object.entries(perms)) {
      expect(operations.get(id)?.['x-permission'], id).toBe(permission);
    }
  });
});

describe('CC-250 계약: 승인 불변성이 DB에 있다', () => {
  const sql = readFileSync(
    join(MIGRATIONS_DIR, '0035_sop_review_approval_and_locked_versions.sql'),
    'utf8',
  );

  it('LOCKED 버전과 그 그래프에 트리거가 걸려 있다', () => {
    // 버전 행만 막으면 그래프는 바뀌는데 해시는 그대로여서 승인한 것과 저장된
    // 것이 달라진다.
    expect(sql).toContain('trg_sop_version_locked_immutable');
    expect(sql).toContain('trg_sop_node_locked_immutable');
    expect(sql).toContain('trg_sop_edge_locked_immutable');
  });

  it('승인 기록은 append-only다', () => {
    expect(sql).toContain('trg_sop_approval_append_only');
    expect(sql).toContain('REVOKE UPDATE, DELETE ON sop_approval FROM une_app');
    // 한 버전은 한 번만 승인된다 — 재승인은 새 버전이다.
    expect(sql).toContain('uk_sop_approval_version UNIQUE (sop_version_id)');
  });

  it('새 테이블 셋 모두 같은 마이그레이션에서 정책을 받는다', () => {
    // 네 번 반복된 사고를 절차로 막는다 — RLS 커버리지 테스트가 짝이다.
    for (const table of ['sop_validation', 'sop_review_request', 'sop_approval']) {
      expect(sql, table).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql, table).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      expect(sql, table).toContain(`CREATE POLICY p_${table}_tenant ON ${table}`);
    }
  });
});
