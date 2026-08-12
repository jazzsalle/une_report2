import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CORRECTABLE_EVENT_TYPES,
  EXECUTION_CORRECTION_EVENT_TYPE,
  PROTECTED_CORRECTION_FIELDS,
} from '@une/domain';
import { loadYaml, repoPath } from './contract-loader';

/**
 * CC-290 계약 게이트 — Execution Log와 전자상황판.
 *
 * 여기서 지키는 것 셋.
 *   (1) **정정이 append-only 규칙을 우회할 수 없다** — 구조가 star이고, 상태를
 *       바꿀 수 없고, 원본을 감추지 않는다.
 *   (2) **대시보드가 임무 행이 아니라 이벤트에서 계산된다**(ADR-43 D1).
 *   (3) 상태를 바꾸는 코드가 사실원장을 건너뛰지 않는다 — CC-280에서 두 번
 *       나온 결함이고, 재생을 정본으로 삼는 순간 기능적 결함이 된다.
 */
const MIGRATIONS_DIR = repoPath('database', 'migrations');

interface Schema {
  enum?: string[];
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean;
  items?: Schema;
  allOf?: Schema[];
  description?: string;
  $ref?: string;
  maxProperties?: number;
  pattern?: string;
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

const JNL_OPS = ['UNE-JNL-001', 'UNE-JNL-002', 'UNE-JNL-003', 'UNE-JNL-004'] as const;

const MIGRATION = readFileSync(join(MIGRATIONS_DIR, '0040_execution_log_projection.sql'), 'utf8');
const SERVICE = readFileSync(
  repoPath('services', 'api', 'src', 'execution', 'execution.service.ts'),
  'utf8',
);
const REPOSITORY = readFileSync(
  repoPath('services', 'api', 'src', 'execution', 'execution.repository.ts'),
  'utf8',
);
const CONTROLLER = readFileSync(
  repoPath('services', 'api', 'src', 'execution', 'execution.controller.ts'),
  'utf8',
);
const ERRORS = readFileSync(
  repoPath('services', 'api', 'src', 'execution', 'execution-errors.ts'),
  'utf8',
);
const DOMAIN = readFileSync(
  repoPath('packages', 'domain', 'src', 'execution', 'execution-log.ts'),
  'utf8',
);

describe('CC-290 계약: 정정이 append-only를 우회하지 못한다', () => {
  it('정정은 자기 타입을 갖는다 — 원본과 같으면 집계가 두 번 센다', () => {
    expect(MIGRATION).toContain(EXECUTION_CORRECTION_EVENT_TYPE);
    expect(MIGRATION).toContain('ck_execution_event_correction_shape');
  });

  it('정정만 corrects_event_id를 갖고, 그 반대도 참이다', () => {
    // 한 방향만 걸면 "정정 타입인데 대상이 없는" 줄이 생긴다.
    expect(MIGRATION).toContain(
      "CHECK ((corrects_event_id IS NULL) = (event_type <> 'EXECUTION_EVENT_CORRECTED'))",
    );
  });

  it('정정의 정정을 DB가 막는다 (star, 사슬 아님)', () => {
    expect(MIGRATION).toContain('trg_execution_correction_star');
    expect(MIGRATION).toContain('정정 이벤트는 다시 정정할 수 없다');
  });

  it('사람이 보고한 사실만 정정할 수 있다', () => {
    // 시스템 관측 이벤트를 정정 대상에 넣으면 "시스템이 그때 그렇게 했다"는
    // 기록을 사람이 고칠 수 있게 된다.
    expect([...CORRECTABLE_EVENT_TYPES]).toEqual([
      'TASK_PROGRESS_REPORTED',
      'TASK_COMPLETION_SUBMITTED',
      'TASK_UNABLE_REPORTED',
      'TASK_ATTACHMENT_ADDED',
    ]);
    for (const forbidden of ['TASK_ACKNOWLEDGED', 'TASK_COMPLETED', 'TASK_SENT', 'RUN_COMPLETED']) {
      expect([...CORRECTABLE_EVENT_TYPES], forbidden).not.toContain(forbidden);
    }
  });

  it('정정으로 status를 바꿀 수 없다', () => {
    // 허용하면 "과거 이력에 현재 상태가 붙던" CC-280의 결함을 정정 경로로
    // 다시 들여온다.
    expect([...PROTECTED_CORRECTION_FIELDS]).toContain('status');
    expect(DOMAIN).toContain('PROTECTED_CORRECTION_FIELDS');
  });

  it('원본 해시를 대조한 뒤에만 정정을 얹는다', () => {
    const correct = SERVICE.slice(SERVICE.indexOf('async correct('));
    expect(correct).toContain('executionEventHash');
    expect(correct).toContain('originalTampered');
    // 정정 payload가 원본 해시를 싣는다 — 원본이 바뀌면 드러난다.
    expect(DOMAIN).toContain('correctedEventHash');
  });

  it('정정은 UPDATE가 아니라 INSERT다', () => {
    expect(REPOSITORY).toContain('insertCorrection');
    expect(REPOSITORY).not.toMatch(/UPDATE\s+execution_event/i);
  });

  it('상세가 원본을 감추지 않는다 (설계 09 REG-05)', () => {
    expect(schemas.ExecutionEventDetail.required).toEqual(
      expect.arrayContaining(['event', 'corrections', 'effectivePayload']),
    );
  });

  it('정정이 감사에 무엇을 바꿨는지 남긴다', () => {
    const correct = SERVICE.slice(SERVICE.indexOf('async correct('));
    expect(correct).toContain('insertAudit');
    expect(correct).toContain('replacementFields');
  });
});

describe('CC-290 계약: 대시보드가 이벤트에서 계산된다', () => {
  it('임무 상태를 임무 행이 아니라 재생에서 얻는다', () => {
    const dashboard = SERVICE.slice(SERVICE.indexOf('async getDashboard('));
    const body = dashboard.slice(0, dashboard.indexOf('async listEvents('));
    expect(body).toContain('foldTaskStates');
    expect(body).toContain('computeKpi');
    // 임무 행의 `currentStatus`는 응답에 실리지 않는다 — 두 정본을 만들지 않는다.
    expect(body).not.toContain('currentStatus');
  });

  it('`at`을 무엇으로 해석하는지 응답이 밝힌다', () => {
    expect(schemas.DashboardView.required).toContain('provenance');
    const prov = schemas.DashboardView.properties?.provenance;
    expect(prov?.required).toEqual(
      expect.arrayContaining(['eventCount', 'timeAxis', 'taskRowFields']),
    );
    expect(prov?.properties?.timeAxis.enum).toEqual(['occurredAt']);
  });

  it('이벤트가 모르는 값이 무엇인지 계약이 적는다', () => {
    const note =
      schemas.DashboardView.properties?.provenance?.properties?.taskRowFields?.description;
    expect(note).toMatch(/이벤트로 남지 않아/);
  });

  it('재생 접근 경로에 맞는 인덱스가 있다', () => {
    // 0040의 `ix_execution_event_fold`는 **어느 질의도 쓰지 않아** 0041이
    // 걷어냈다. 근거로 든 인덱스가 실제로 안 쓰이면 쓰기 비용만 남는다.
    const fix = readFileSync(join(MIGRATIONS_DIR, '0041_execution_log_review_fixes.sql'), 'utf8');
    expect(fix).toContain('DROP INDEX IF EXISTS ix_execution_event_fold');
    expect(fix).toContain('ix_execution_event_aggregate');
  });

  it('임무 상태 어휘를 대시보드가 따로 적지 않는다', () => {
    expect(schemas.DashboardTask.properties?.status.allOf?.[0].$ref).toBe(
      '#/components/schemas/TaskStatus',
    );
  });
});

describe('CC-290 계약: 상태 변경이 사실원장을 건너뛰지 않는다', () => {
  it('릴레이가 임무를 SENT로 올릴 때 이벤트를 남긴다', () => {
    // CC-280의 H1과 같은 계열이다. 재생을 정본으로 삼는 순간 이 구멍은
    // "대시보드가 그 임무를 영원히 CREATED로 본다"가 된다.
    const relay = readFileSync(
      repoPath('services', 'worker', 'src', 'dispatch', 'outbox.repository.ts'),
      'utf8',
    );
    const fn = relay.slice(relay.indexOf('export async function markTaskSent'));
    expect(fn).toContain('INSERT INTO execution_event');
    expect(fn).toContain("'TASK_SENT'");
    // 0041이 컬럼 단위로 좁혔다 — 테이블 전체 INSERT는 `corrects_event_id`를
    // 포함해 워커에게 정정 권한까지 준 셈이었다.
    const fix = readFileSync(join(MIGRATIONS_DIR, '0041_execution_log_review_fixes.sql'), 'utf8');
    expect(fix).toContain('REVOKE INSERT ON execution_event FROM une_worker');
    expect(fix).toContain('GRANT INSERT (tenant_id');
    // 워커가 받은 컬럼 목록에 정정 대상이 없다.
    const granted = fix.slice(fix.indexOf('GRANT INSERT (tenant_id'));
    expect(granted.slice(0, 300)).not.toContain('corrects_event_id');
    // 그리고 이벤트를 못 남기면 성공을 돌려주지 않는다.
    expect(fn).toContain('throw new Error');
  });

  it('임무 생성·취소가 임무별로 남는다', () => {
    // 실행 단위 요약(taskCount)만으로는 어느 임무가 언제 생겼는지 알 수 없어
    // 시점 재생이 불가능하다.
    const run = readFileSync(
      repoPath('services', 'api', 'src', 'sop', 'sop-run.service.ts'),
      'utf8',
    );
    const materialize = run.slice(run.indexOf('private async materializeTasks'));
    const body = materialize.slice(0, materialize.indexOf('private async sopIdOfVersion'));
    expect(body).toContain("aggregateType: 'TASK'");
    expect(body).toContain("eventType: 'TASK_CREATED'");
    expect(run).toContain("eventType: 'TASK_CANCELLED'");
  });

  it('임무 이벤트가 그 시점의 상태를 들고 있다', () => {
    // 재생이 여기에 전적으로 기댄다.
    const run = readFileSync(
      repoPath('services', 'api', 'src', 'sop', 'sop-run.service.ts'),
      'utf8',
    );
    expect(run).toContain("status: 'CREATED'");
    expect(run).toContain("status: 'CANCELLED'");
    const task = readFileSync(
      repoPath('services', 'api', 'src', 'task', 'task.service.ts'),
      'utf8',
    );
    expect(task).toContain('const payload = { ...step.payload, status: step.status }');
  });
});

describe('CC-290 계약: 자리표시자가 남아 있지 않다', () => {
  it('네 오퍼레이션이 실제 스키마를 가리킨다', () => {
    const expected: Record<string, string> = {
      'UNE-JNL-001': 'DashboardView',
      'UNE-JNL-002': 'ExecutionEventPage',
      'UNE-JNL-003': 'ExecutionEventDetail',
      'UNE-JNL-004': 'ExecutionEvent',
    };
    for (const id of JNL_OPS) {
      const op = operations.get(id);
      expect(op, id).toBeDefined();
      const responses = op?.responses as Record<
        string,
        { content?: Record<string, { schema?: { $ref?: string } }> }
      >;
      const success = responses['200'] ?? responses['201'];
      const ref = success?.content?.['application/json']?.schema?.$ref ?? '';
      expect(ref, id).toBe(`#/components/schemas/${expected[id]}`);
      expect(schemas[expected[id]]?.additionalProperties, id).toBe(false);
    }
  });

  it('정정 요청이 전용 스키마다', () => {
    const body = operations.get('UNE-JNL-004')?.requestBody as {
      required: boolean;
      content: Record<string, { schema: { $ref?: string } }>;
    };
    expect(body.required).toBe(true);
    expect(body.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/ExecutionCorrectionRequest',
    );
    expect(schemas.ExecutionCorrectionRequest.additionalProperties).toBe(false);
  });

  it('조회 파라미터를 계약이 선언한다', () => {
    const names = (id: string): string[] =>
      ((operations.get(id)?.parameters as Array<{ name?: string }> | undefined) ?? [])
        .map((p) => p.name)
        .filter((n): n is string => typeof n === 'string');
    expect(names('UNE-JNL-001')).toEqual(expect.arrayContaining(['at', 'runId']));
    expect(names('UNE-JNL-002')).toEqual(
      expect.arrayContaining(['from', 'to', 'type', 'actor', 'page', 'size']),
    );
  });
});

describe('CC-290 계약: 오류코드 선언이 사실이다', () => {
  const callers = [SERVICE, CONTROLLER].join('\n');
  const defined = [...ERRORS.matchAll(/ApiError\(\s*\d{3},\s*'([A-Z0-9-]+)'/g)].map((m) => m[1]);

  it('정의만 있고 아무도 부르지 않는 코드가 없다', () => {
    const names = [...ERRORS.matchAll(/^ {2}([a-zA-Z]+): \(/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(callers.includes(`executionErrors.${name}(`), `executionErrors.${name} 미사용`).toBe(
        true,
      );
    }
  });

  it('구현이 던지는 코드는 모두 선언돼 있다', () => {
    const declared = new Set<string>();
    for (const id of JNL_OPS) {
      for (const code of (operations.get(id)?.['x-error-codes'] as string[] | undefined) ?? []) {
        declared.add(code);
      }
    }
    for (const code of defined) {
      expect(declared.has(code), `${code}가 계약에 선언되지 않았다`).toBe(true);
    }
  });

  it('계약이 선언한 코드는 모두 구현이 던진다 (ADR-33 D17)', () => {
    // `COM-*`는 공통 필터가 낸다 — 본문 상한 초과(413)가 그렇다.
    const thrown = new Set([...defined, 'COM-0400', 'COM-0413']);
    for (const id of JNL_OPS) {
      for (const code of (operations.get(id)?.['x-error-codes'] as string[] | undefined) ?? []) {
        expect(thrown.has(code), `${id}이 선언한 ${code}를 구현이 던지지 않는다`).toBe(true);
      }
    }
  });

  it('본문 상한 초과를 500이 아니라 413으로 낸다', () => {
    // 전에는 express 기본 100kb에 걸린 요청이 HttpException이 아니라서 500
    // COM-0001로 나갔다(실측). 본문이 크다는 것은 요청의 문제다.
    const filter = readFileSync(
      repoPath('services', 'api', 'src', 'common', 'api-error.filter.ts'),
      'utf8',
    );
    expect(filter).toContain('entity.too.large');
    expect(filter).toContain("'COM-0413'");
    const factory = readFileSync(repoPath('services', 'api', 'src', 'app.factory.ts'), 'utf8');
    expect(factory).toContain('json({ limit: config.jsonMaxBytes })');
  });

  it('정정 본문 오류에 조회용 코드를 쓰지 않는다', () => {
    expect(CONTROLLER).toContain('invalidCorrectionRequest');
    expect(ERRORS).toContain("'EXEC-400-001'");
  });

  it('화면이 스스로 판단하는 것을 서버 오류로 만들지 않았다', () => {
    // BOARD-5401(SSE 끊김)·5402(Projection 지연)는 서버가 알 수 없는 사실이다.
    expect(ERRORS).not.toMatch(/'BOARD-54\d\d'/);
    const boardState = readFileSync(
      repoPath('apps', 'web', 'src', 'board', 'board-state.ts'),
      'utf8',
    );
    expect(boardState).toContain('RECONNECTING');
    expect(boardState).toContain('STALE');
  });
});

describe('CC-290 계약: allOf 함정을 문서 전체에서 막는다', () => {
  it('어느 allOf 브랜치에도 additionalProperties:false가 없다 (ADR-24 D4)', () => {
    // 2020-12에서 그 조합은 형제 브랜치의 property를 보지 못해 **모든 인스턴스를
    // 무효로 만든다.** CC-290이 `ExecutionEventTimelineItem`에서 그것을 밟았고,
    // 기존 walker는 JSON Schema 파일만 훑어 잡지 못했다.
    const offenders: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        node.forEach((child, i) => walk(child, `${path}[${i}]`));
        return;
      }
      if (typeof node !== 'object' || node === null) return;
      const obj = node as Record<string, unknown>;
      if (Array.isArray(obj.allOf)) {
        obj.allOf.forEach((branch, i) => {
          const b = branch as Record<string, unknown> | null;
          if (b && b.additionalProperties === false) offenders.push(`${path}.allOf[${i}]`);
        });
      }
      for (const [key, value] of Object.entries(obj)) walk(value, `${path}.${key}`);
    };
    walk(doc, '#');
    expect(offenders).toEqual([]);
  });

  it('`$ref` 옆에 nullable을 두지 않는다', () => {
    // 3.1에서 `nullable`은 키워드가 아니라 무시된다 — 그 자리에 null을 내보내면
    // 계약 위반이다. 이 파일의 확립된 형태는 `anyOf: [$ref, {type: null}]`이다.
    const offenders: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        node.forEach((child, i) => walk(child, `${path}[${i}]`));
        return;
      }
      if (typeof node !== 'object' || node === null) return;
      const obj = node as Record<string, unknown>;
      if (obj.$ref !== undefined && obj.nullable !== undefined) offenders.push(path);
      for (const [key, value] of Object.entries(obj)) walk(value, `${path}.${key}`);
    };
    walk(doc.components, '#/components');
    expect(offenders).toEqual([]);
  });
});

describe('CC-290 계약: 판이 자기 근거와 어긋남을 밝힌다', () => {
  it('provenance가 잘림·결손·어긋남을 함께 낸다', () => {
    const prov = schemas.DashboardView.properties?.provenance;
    expect(prov?.required).toEqual(
      expect.arrayContaining([
        'eventCount',
        'truncated',
        'timeAxis',
        'taskRowFields',
        'tasksWithoutEvents',
        'divergences',
      ]),
    );
  });

  it('재생과 임무 행을 실제로 대조한다', () => {
    // ADR이 "대조가 정합성 시험이 된다"고 적었는데 그 코드가 없으면 문장만
    // 남는다. D1의 전제는 매 조회가 측정해야 한다.
    expect(DOMAIN).toContain('export function findDivergences');
    expect(SERVICE).toContain('findDivergences(tasks, states)');
  });

  it('KPI에서 사실원장으로 내려가는 길이 있다', () => {
    expect(schemas.DashboardTask.required).toContain('statusEventId');
  });

  it('진행률도 이벤트에서 복원한다', () => {
    const dashboard = SERVICE.slice(SERVICE.indexOf('async getDashboard('));
    const body = dashboard.slice(0, dashboard.indexOf('async listEvents('));
    expect(body).toContain('projected.progressPct');
  });

  it('집계는 정정본으로, 표시는 원본으로 접는다', () => {
    const dashboard = SERVICE.slice(SERVICE.indexOf('async getDashboard('));
    const body = dashboard.slice(0, dashboard.indexOf('async listEvents('));
    expect(body).toContain('const corrected = applyCorrections(scoped)');
    expect(body).toContain('foldTaskStates(corrected, at)');
    // 표시는 원본 payload + 표시만. 정정본을 원본 해시와 함께 내보내면 해시
    // 검증이 깨진다.
    expect(body).toContain('markCorrected(scoped)');
  });

  it('정정 이벤트는 재생에서 새 관측이 아니다', () => {
    expect(DOMAIN).toContain('if (e.correctsEventId) continue;');
  });

  it('실행 스코프를 payload가 아니라 DB에서 유도한다', () => {
    expect(SERVICE).toContain('runTaskIds.has(event.aggregateId)');
  });

  it('재생에 천장이 있고 잘렸다는 사실을 응답이 밝힌다', () => {
    expect(REPOSITORY).toContain('REPLAY_LIMIT');
    expect(SERVICE).toContain('truncated');
  });
});

describe('CC-290 계약: 투영 테이블을 만들지 않았다', () => {
  it('journal_projection_item은 CC-300의 것이다', () => {
    // 주석으로 언급하는 것은 좋다 — 왜 안 썼는지가 남는다. 금지하는 것은
    // 그 테이블에 손대는 것이다.
    const touches = /(?:CREATE|ALTER|INSERT INTO|DROP).*journal_projection_item/i;
    expect(MIGRATION).not.toMatch(touches);
    const guard = readFileSync(
      repoPath('tests', 'integration', 'src', 'rls-coverage.test.ts'),
      'utf8',
    );
    expect(guard).toContain("'journal_projection_item'");
  });

  it('새 테이블을 만들지 않았다', () => {
    expect(MIGRATION).not.toMatch(/CREATE TABLE/i);
  });
});
