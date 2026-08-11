import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ESCALATION_LEVELS,
  FIELD_TASK_STATUSES,
  SOP_RUN_STATUSES,
  TASK_ATTACHMENT_CATEGORIES,
  TASK_EVENT_TYPES,
  UNABLE_REASON_CODES,
} from '@une/domain';
import { loadYaml, repoPath } from './contract-loader';

/**
 * CC-280 계약 게이트 — 현장 임무 어휘가 마이그레이션·도메인·계약에서 같은가,
 * 그리고 **넣지 않기로 한 값이 조용히 되살아나지 않는가.**
 *
 * 설계 09의 Task 상태표는 열하나를 적는데 우리는 여덟만 쓴다. 그 판단(0038 §1)
 * 은 근거가 있는 것이고, 근거를 모르는 다음 사람이 "설계서에 있으니까" 하고
 * 되살리기 쉽다. 그때 여기서 걸린다.
 */
const MIGRATIONS_DIR = repoPath('database', 'migrations');

interface Schema {
  enum?: string[];
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean;
  items?: Schema;
  description?: string;
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

const FIELD_OPS = [
  'UNE-TASK-001',
  'UNE-TASK-002',
  'UNE-TASK-004',
  'UNE-TASK-005',
  'UNE-TASK-006',
  'UNE-TASK-007',
  'UNE-TASK-008',
  'UNE-TASK-009',
  'UNE-TASK-010',
  'UNE-TASK-011',
  'UNE-TASK-012',
] as const;

const MIGRATION = readFileSync(join(MIGRATIONS_DIR, '0038_field_task_execution.sql'), 'utf8');
const SERVICE = readFileSync(repoPath('services', 'api', 'src', 'task', 'task.service.ts'), 'utf8');
const REPOSITORY = readFileSync(
  repoPath('services', 'api', 'src', 'task', 'task.repository.ts'),
  'utf8',
);
const CONTROLLER = readFileSync(
  repoPath('services', 'api', 'src', 'task', 'task.controller.ts'),
  'utf8',
);
const ERRORS = readFileSync(repoPath('services', 'api', 'src', 'task', 'task-errors.ts'), 'utf8');

describe('CC-280 계약: 임무 어휘가 세 곳에서 같다', () => {
  it('임무 상태 8종', () => {
    const fromDb = checkValues('ck_task_status');
    expect(fromDb).toEqual([...FIELD_TASK_STATUSES]);
    // 어휘는 `TaskStatus` 하나가 갖고 `Task`·`TaskEvent`·목록 질의가 그것을
    // 참조한다 — 같은 목록을 세 군데 베끼면 반드시 갈라진다.
    expect(schemas.TaskStatus.enum).toEqual(fromDb);
    expect(schemas.Task.properties?.status.$ref).toBe('#/components/schemas/TaskStatus');
    expect(schemas.TaskEvent.properties?.taskStatus.$ref).toBe('#/components/schemas/TaskStatus');
  });

  it('관측되지 않는 셋을 어디에도 넣지 않았다', () => {
    // DELIVERED: 수신영수증을 주는 채널이 없다(OB-06).
    // REJECTED: 반려하는 순간 IN_PROGRESS가 된다.
    // REASSIGNED: 재배정하면 새 담당자의 SENT가 된다.
    const fromDb = checkValues('ck_task_status');
    for (const ghost of ['DELIVERED', 'REJECTED', 'REASSIGNED']) {
      expect(fromDb, `DB에 ${ghost}`).not.toContain(ghost);
      expect(schemas.TaskStatus.enum, `계약에 ${ghost}`).not.toContain(ghost);
      expect([...FIELD_TASK_STATUSES], `도메인에 ${ghost}`).not.toContain(ghost);
    }
  });

  it('반려·재배정은 상태가 아니라 이벤트로 남는다', () => {
    expect(schemas.TaskEvent.properties?.eventType.enum).toEqual([...TASK_EVENT_TYPES]);
    expect([...TASK_EVENT_TYPES]).toContain('COMPLETION_REJECTED');
    expect([...TASK_EVENT_TYPES]).toContain('REASSIGNED');
  });

  it('실행 상태에 COMPLETED가 열렸다 (FAILED는 여전히 없다)', () => {
    const fromDb = checkValues('ck_sop_run_status');
    expect(fromDb).toEqual([...SOP_RUN_STATUSES]);
    expect(fromDb).toContain('COMPLETED');
    // 그 값을 만드는 경로가 아직 없다.
    expect(fromDb).not.toContain('FAILED');
  });

  it('첨부 분류 4종', () => {
    const fromDb = checkValues('ck_task_attachment_category');
    expect(fromDb).toEqual([...TASK_ATTACHMENT_CATEGORIES]);
    expect(schemas.TaskAttachment.properties?.category.enum).toEqual(fromDb);
  });

  it('배정 출처 2종', () => {
    expect(checkValues('ck_task_assignment_source')).toEqual(['DISPATCH', 'REASSIGN']);
    expect(schemas.TaskAssignment.properties?.source.enum).toEqual(['DISPATCH', 'REASSIGN']);
  });

  it('수행불가 사유·Escalation 단계가 계약과 도메인에서 같다', () => {
    expect(schemas.TaskCompleteRequest.properties?.unableReasonCode.enum).toEqual([
      ...UNABLE_REASON_CODES,
    ]);
    expect(schemas.TaskEscalateRequest.properties?.level.enum).toEqual([...ESCALATION_LEVELS]);
  });
});

describe('CC-280 계약: 자리표시자가 남아 있지 않다', () => {
  it('TaskActionRequest 자리표시자를 지웠다', () => {
    expect(schemas.TaskActionRequest).toBeUndefined();
  });

  it('모든 현장 임무 요청·응답이 실제 스키마를 가리킨다', () => {
    for (const id of FIELD_OPS) {
      const op = operations.get(id);
      expect(op, id).toBeDefined();
      const responses = op?.responses as Record<
        string,
        { content?: Record<string, { schema?: { $ref?: string } }> }
      >;
      const success = responses['200'] ?? responses['201'];
      const ref = success?.content?.['application/json']?.schema?.$ref ?? '';
      expect(ref, `${id} 응답`).toMatch(/#\/components\/schemas\/Task/);
      const name = ref.split('/').pop() as string;
      // additionalProperties: true인 응답은 아무것도 약속하지 않는다.
      expect(schemas[name]?.additionalProperties, `${id} 응답 ${name}`).toBe(false);
    }
  });

  it('본문을 받는 조작은 전용 요청 스키마를 갖는다', () => {
    const withBody = FIELD_OPS.filter((id) => operations.get(id)?.requestBody);
    expect(withBody.length).toBe(9);
    for (const id of withBody) {
      const body = operations.get(id)?.requestBody as {
        content: Record<string, { schema: { $ref?: string } }>;
      };
      const ref = body.content['application/json'].schema.$ref ?? '';
      const name = ref.split('/').pop() as string;
      expect(name, id).toMatch(/^Task.*Request$/);
      expect(schemas[name]?.additionalProperties, `${id} 요청 ${name}`).toBe(false);
    }
  });
});

describe('CC-280 계약: 오류코드 선언이 사실이다', () => {
  const callers = [SERVICE, CONTROLLER].join('\n');
  const defined = [...ERRORS.matchAll(/ApiError\(\s*\d{3},\s*'([A-Z0-9-]+)'/g)].map((m) => m[1]);

  it('정의만 있고 아무도 부르지 않는 코드가 없다', () => {
    const names = [...ERRORS.matchAll(/^ {2}([a-zA-Z]+): \(/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(callers.includes(`taskErrors.${name}(`), `taskErrors.${name} 미사용`).toBe(true);
    }
  });

  it('구현이 던지는 코드는 모두 어느 호출부에든 선언돼 있다', () => {
    const declared = new Set<string>();
    for (const id of FIELD_OPS) {
      for (const code of (operations.get(id)?.['x-error-codes'] as string[] | undefined) ?? []) {
        declared.add(code);
      }
    }
    for (const code of defined) {
      expect(declared.has(code), `${code}가 계약에 선언되지 않았다`).toBe(true);
    }
  });

  it('계약이 선언한 코드는 모두 구현이 던진다 (ADR-33 D17)', () => {
    const thrown = new Set([...defined, 'COM-0400', 'TASK-400-001']);
    for (const id of FIELD_OPS) {
      for (const code of (operations.get(id)?.['x-error-codes'] as string[] | undefined) ?? []) {
        expect(thrown.has(code), `${id}이 선언한 ${code}를 구현이 던지지 않는다`).toBe(true);
      }
    }
  });

  it('CC-270이 쓰는 번호와 뜻이 겹치지 않는다', () => {
    // 같은 코드에 다른 뜻을 겹치면 클라이언트가 코드로 분기할 수 없다.
    const dispatch = readFileSync(
      repoPath('services', 'api', 'src', 'dispatch', 'dispatch.service.ts'),
      'utf8',
    );
    expect(dispatch).toContain("'TASK-412-001'");
    expect(ERRORS).not.toContain("'TASK-412-001'");
    expect(ERRORS).toContain("'TASK-412-003'");
  });
});

describe('CC-280 계약: 담당자 확인이 두 계층이다', () => {
  it('서비스가 담당자 본인을 먼저 본다', () => {
    expect(SERVICE).toContain('loadForAssignee');
    expect(SERVICE).toContain('taskErrors.notAssignee()');
  });

  it('조건부 UPDATE가 상태와 담당자를 함께 건다', () => {
    // 가드 통과 후 재배정이 일어나는 시간차 경합을 DB가 막는다.
    const transition = REPOSITORY.slice(REPOSITORY.indexOf('async transitionTask'));
    const sql = transition.slice(0, transition.indexOf('async updateProgress'));
    expect(sql).toContain('AND status = $2');
    expect(sql).toContain('assignee_user_id = $4');
    const progress = REPOSITORY.slice(REPOSITORY.indexOf('async updateProgress'));
    expect(progress.slice(0, progress.indexOf('async reassignTask'))).toContain(
      'AND assignee_user_id = $3',
    );
  });

  it('담당자 없는 임무가 수행 상태로 가는 것을 DB가 막는다', () => {
    expect(MIGRATION).toContain('ck_task_assignee_required');
  });
});

describe('CC-280 계약: 원자성과 append-only', () => {
  it('모든 전이가 이벤트·사실원장·감사와 한 트랜잭션이다', () => {
    const apply = SERVICE.slice(SERVICE.indexOf('private async applyTransition'));
    const body = apply.slice(0, apply.indexOf('private async recordEvent'));
    expect(body).toContain('transitionTask');
    expect(body).toContain('recordEvent');
    const record = SERVICE.slice(SERVICE.indexOf('private async recordEvent'));
    const recordBody = record.slice(0, record.indexOf('private async notify'));
    expect(recordBody).toContain('insertTaskEvent');
    expect(recordBody).toContain('insertExecutionEvent');
    expect(recordBody).toContain('insertAudit');
  });

  it('알림도 채널을 직접 부르지 않는다 (ADR-41 D1)', () => {
    const notify = SERVICE.slice(SERVICE.indexOf('private async notify'));
    const body = notify.slice(0, notify.indexOf('private async advanceRun'));
    expect(body).toContain('insertOutbox');
    expect(body).not.toContain('.send(');
  });

  it('알림 전파는 임무를 SENT로 만들지 않는다', () => {
    // 릴레이는 `TASK` 전파가 성공하면 그 임무를 SENT로 올린다. 알림이 같은
    // 종류를 쓰면 지시가 한 번도 나가지 않은 임무가 "전파됨"이 되고, 그 전이는
    // 상태기계를 거치지 않아 이벤트도 남지 않는다(0039 §1).
    const notify = SERVICE.slice(SERVICE.indexOf('private async notify'));
    const body = notify.slice(0, notify.indexOf('private async advanceRun'));
    expect(body).toContain('TASK_NOTICE');

    const relay = readFileSync(
      repoPath('services', 'worker', 'src', 'dispatch', 'outbox.repository.ts'),
      'utf8',
    );
    const lookup = relay.slice(relay.indexOf('export async function findTaskIdOfDispatch'));
    expect(lookup.slice(0, 400)).toContain("message_type = 'TASK'");
    expect(checkValues('ck_dispatch_message_type')).toContain('TASK_NOTICE');
  });

  it('실행 종료 판정이 실행 행을 잠그고 돈다', () => {
    // 서로 다른 임무를 동시에 승인하면 잠금이 겹치지 않아 둘 다 상대를 아직
    // 미완료로 본다 — 모든 임무가 COMPLETED인데 실행이 RUNNING에 갇힌다.
    const advance = SERVICE.slice(SERVICE.indexOf('private async advanceRun'));
    expect(advance.slice(0, 900)).toContain('forUpdate: true');
  });

  it('끝난 실행의 임무는 DB도 막는다 (COMPLETED 포함)', () => {
    const guard = readFileSync(
      join(MIGRATIONS_DIR, '0039_task_notice_and_settled_runs.sql'),
      'utf8',
    );
    expect(guard).toContain("run_status IN ('TERMINATED', 'COMPLETED')");
  });

  it('이벤트가 자기 시점의 상태를 들고 있다', () => {
    // 이것이 없으면 이력을 낼 때 모든 과거 이벤트에 현재 상태가 붙는다.
    expect(SERVICE).toContain('const payload = { ...step.payload, status: step.status }');
    expect(SERVICE).toContain('const recorded = row.payload.status');
  });

  it('저장소가 테넌트를 명시적으로 건다 (ADR-21 보상통제)', () => {
    // RLS가 이미 걸지만 그것 하나만 남기면 정책이 드롭되는 순간 격리가 사라진다.
    const find = REPOSITORY.slice(REPOSITORY.indexOf('async findTask'));
    expect(find.slice(0, 1200)).toContain('s.tenant_id = $2');
    const list = REPOSITORY.slice(REPOSITORY.indexOf('async listTasks'));
    expect(list.slice(0, 2000)).toContain('s.tenant_id = $1');
  });

  it('첨부 정책이 파일의 테넌트도 본다', () => {
    const guard = readFileSync(
      join(MIGRATIONS_DIR, '0039_task_notice_and_settled_runs.sql'),
      'utf8',
    );
    expect(guard).toContain('f.tenant_id = une_current_tenant_id()');
  });

  it('배정 이력은 고칠 수 없다', () => {
    expect(MIGRATION).toContain('trg_task_assignment_append_only');
    expect(MIGRATION).toContain('REVOKE UPDATE, DELETE ON task_assignment FROM une_app');
  });

  it('첨부도 지우지 않는다', () => {
    expect(MIGRATION).toContain('REVOKE UPDATE, DELETE ON task_attachment FROM une_app');
  });

  it('RLS 커버리지 목록에서 task_attachment를 닫았다', () => {
    expect(MIGRATION).toContain('p_task_attachment_tenant');
    const guard = readFileSync(
      repoPath('tests', 'integration', 'src', 'rls-coverage.test.ts'),
      'utf8',
    );
    const known = guard.slice(guard.indexOf('const KNOWN_OPEN'), guard.indexOf('describe.skipIf'));
    expect(known).not.toContain("'task_attachment'");
  });
});

describe('CC-280 계약: 서명링크를 만들지 않았다는 사실이 드러난다', () => {
  it('마이그레이션이 그 판단과 이유를 적는다', () => {
    // 설계 09가 /task/:signedToken을 적는데 우리는 그것을 만들지 않았다.
    // 배달할 채널이 없는 bearer 인증 경로는 공격면만 있고 사용자가 없다.
    expect(MIGRATION).toContain('서명링크');
    expect(MIGRATION).toContain('OB-06');
  });

  it('화면 오류 TASK-52xx를 던지지 않는다', () => {
    // 그 번호들은 서명링크 화면을 전제로 한다. 매핑은 주석이 적는다.
    expect(ERRORS).not.toMatch(/'TASK-52\d\d'/);
    // 매핑은 주석에 남긴다 — 그 번호가 어디로 갔는지 물을 사람이 있다.
    expect(ERRORS).toContain('5203 중복 수신확인');
  });

  it('현장 앱이 mock 로그인뿐이라는 사실을 화면이 말한다', () => {
    // "그래서 현장 담당자는 로그인한다"가 실 환경에서 아직 사실이 아니다.
    const app = readFileSync(
      repoPath('apps', 'field-web', 'src', 'task', 'FieldTaskApp.tsx'),
      'utf8',
    );
    expect(app).toContain('AUTH_MODE=mock');
    expect(app).toContain('OB-01');
  });

  it('오프라인 대기열이 못 보낸 같은 행위의 멱등키를 재사용한다', () => {
    // 새로 만들면 오프라인에서 두 번 누른 보고가 서로 다른 키로 쌓이고 복구
    // 시 둘 다 나간다 — 진행보고는 상태를 바꾸지 않아 중복이 그대로 남는다.
    const app = readFileSync(
      repoPath('apps', 'field-web', 'src', 'task', 'FieldTaskApp.tsx'),
      'utf8',
    );
    expect(app).toContain('queue.findPending(');
    expect(app).toContain('queued?.idempotencyKey ??');
  });

  it('현장 앱이 계약에서 타입을 받는다', () => {
    const app = readFileSync(
      repoPath('apps', 'field-web', 'src', 'task', 'FieldTaskApp.tsx'),
      'utf8',
    );
    expect(app).toContain("from '../generated/une-platform-api'");
    expect(app).toContain("components['schemas']['TaskDetail']");
  });
});
