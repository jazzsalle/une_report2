import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DISPATCH_CHANNELS,
  DISPATCH_STATUSES,
  OUTBOX_ATTEMPT_RESULTS,
  OUTBOX_STATUSES,
  RECIPIENT_STATUSES,
  TASK_STATUSES,
} from '@une/domain';
import { loadYaml, repoPath } from './contract-loader';

/**
 * CC-270 계약 게이트 — 전파·Outbox 어휘가 마이그레이션·도메인·계약에서 같은가.
 *
 * 앞선 게이트들과 같은 규칙이고, 하나가 더 있다: **시뮬레이션이라는 사실이
 * 계약에 드러나는가.** OB-06이 열려 있는 동안 그것이 보이지 않으면 화면이
 * "전파됐다"로 읽는다.
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

const DISPATCH_OPS = ['UNE-TASK-003', 'UNE-TASK-013', 'UNE-TASK-014'] as const;

describe('CC-270 계약: 어휘가 세 곳에서 같다', () => {
  it('Outbox 상태 5종 — CANCELLED는 아직 없다', () => {
    const fromDb = checkValues('ck_outbox_message_status');
    expect(fromDb).toEqual([...OUTBOX_STATUSES]);
    expect(fromDb).not.toContain('CANCELLED');
  });

  it('시도 결과 3종', () => {
    expect(checkValues('ck_outbox_attempt_result')).toEqual([...OUTBOX_ATTEMPT_RESULTS]);
  });

  it('채널 4종이 세 제약과 도메인에서 같다', () => {
    const fromOutbox = checkValues('ck_outbox_message_channel');
    const fromRecipient = checkValues('ck_dispatch_recipient_channel');
    expect(fromOutbox).toEqual([...DISPATCH_CHANNELS]);
    expect(fromRecipient).toEqual([...DISPATCH_CHANNELS]);
    expect(schemas.DispatchRecipient.properties?.channel.enum).toEqual(fromOutbox);
  });

  it('전파 상태 5종', () => {
    const fromDb = checkValues('ck_dispatch_status');
    expect(fromDb).toEqual([...DISPATCH_STATUSES]);
    expect(schemas.Dispatch.properties?.status.enum).toEqual(fromDb);
  });

  it('수신자 상태 3종 — DELIVERED는 수신영수증이 있어야 온다(OB-06)', () => {
    const fromDb = checkValues('ck_dispatch_recipient_status');
    expect(fromDb).toEqual([...RECIPIENT_STATUSES]);
    expect(schemas.DispatchRecipient.properties?.deliveryStatus.enum).toEqual(fromDb);
    expect(fromDb).not.toContain('DELIVERED');
  });

  it('임무 상태에 SENT가 있다 (CC-260이 예고하고 CC-270이 연 확장)', () => {
    const fromDb = checkValues('ck_task_status');
    expect(fromDb).toEqual([...TASK_STATUSES]);
    expect(fromDb).toContain('SENT');
    // 수행 상태는 CC-280이 넓혔다. DELIVERED는 여전히 없다 — 그 값을 만들려면
    // 수신영수증을 주는 실제 채널이 있어야 한다(OB-06).
    expect(fromDb).not.toContain('DELIVERED');
  });
});

describe('CC-270 계약: 시뮬레이션이 드러난다', () => {
  it('수신자에 simulated 플래그가 필수다', () => {
    // 이것이 없으면 화면이 "전파됐다"로 읽는다.
    expect(schemas.DispatchRecipient.required).toContain('simulated');
    expect(schemas.DispatchRecipient.properties?.simulated.description).toMatch(/OB-06/);
  });

  it('시도 이력에도 simulated가 있다', () => {
    expect(schemas.DispatchAttempt.properties?.simulated).toBeDefined();
  });

  it('어댑터가 시뮬레이션 여부를 스스로 밝힌다', () => {
    const port = readFileSync(
      repoPath('packages', 'provider-adapters', 'src', 'channel', 'channel-port.ts'),
      'utf8',
    );
    expect(port).toContain('isSimulated');
    const adapter = readFileSync(
      repoPath('packages', 'provider-adapters', 'src', 'channel', 'simulation-channel-adapter.ts'),
      'utf8',
    );
    // 성공 응답에도 남는다.
    expect(adapter).toContain('simulated: true');
  });
});

describe('CC-270 계약: 오류코드 선언이 사실이다', () => {
  const source = readFileSync(
    repoPath('services', 'api', 'src', 'dispatch', 'dispatch.service.ts'),
    'utf8',
  );
  const callers = [
    source,
    readFileSync(repoPath('services', 'api', 'src', 'dispatch', 'dispatch.controller.ts'), 'utf8'),
  ].join('\n');
  const defined = [...source.matchAll(/ApiError\(\s*\d{3},\s*'([A-Z0-9-]+)'/g)].map((m) => m[1]);

  it('정의만 있고 아무도 부르지 않는 코드가 없다', () => {
    const names = [...source.matchAll(/^ {2}([a-zA-Z]+): \(/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(callers.includes(`dispatchErrors.${name}(`), `dispatchErrors.${name} 미사용`).toBe(
        true,
      );
    }
  });

  it('구현이 던지는 코드는 모두 선언돼 있다', () => {
    const declared = new Set<string>();
    for (const id of DISPATCH_OPS) {
      for (const code of (operations.get(id)?.['x-error-codes'] as string[] | undefined) ?? []) {
        declared.add(code);
      }
    }
    for (const code of defined) {
      expect(declared.has(code), `${code}가 계약에 선언되지 않았다`).toBe(true);
    }
  });

  it('계약이 선언한 코드는 모두 구현이 던진다 (ADR-33 D17)', () => {
    for (const id of DISPATCH_OPS) {
      for (const code of (operations.get(id)?.['x-error-codes'] as string[] | undefined) ?? []) {
        if (code.startsWith('COM-')) continue;
        expect(defined.includes(code), `${id}이 선언한 ${code}를 구현이 던지지 않는다`).toBe(true);
      }
    }
  });
});

describe('CC-270 계약: 원자성과 큐가 DB에 있다', () => {
  const sql = readFileSync(join(MIGRATIONS_DIR, '0037_outbox_relay_and_dispatch.sql'), 'utf8');

  it('접수가 Outbox와 사실원장을 같은 트랜잭션에 쓴다', () => {
    // 비협상 규칙: 상태변경·Execution Event·Outbox insert는 한 트랜잭션이다.
    const service = readFileSync(
      repoPath('services', 'api', 'src', 'dispatch', 'dispatch.service.ts'),
      'utf8',
    );
    const body = service.slice(service.indexOf('async dispatchTask'));
    const tx = body.slice(0, body.indexOf('async getStatus'));
    expect(tx).toContain('withTenant');
    expect(tx).toContain('insertOutbox');
    expect(tx).toContain('insertExecutionEvent');
    expect(tx).toContain('insertAudit');
    // 트랜잭션 안에서 채널을 부르지 않는다.
    expect(tx).not.toContain('.send(');
  });

  it('중복 억제 유니크 인덱스에 테넌트가 들어 있다', () => {
    // 0007의 인덱스는 테넌트가 빠져 있어 두 기관이 같은 키를 쓰면 한쪽이 막혔다.
    expect(sql).toContain('CREATE UNIQUE INDEX uk_outbox_idem');
    expect(sql).toContain('ON outbox_message (tenant_id, idempotency_key, channel)');
  });

  it('릴레이는 끝난 줄을 되돌리지 못한다', () => {
    expect(sql).toContain('p_outbox_message_worker_open_only');
    // **WITH CHECK (true)가 있어야 한다** — RESTRICTIVE에 USING만 쓰면 종결
    // 자체가 막힌다(실측: 메시지가 SENDING에 머물렀다).
    expect(sql).toContain('WITH CHECK (true)');
  });

  it('릴레이는 보낼 내용을 바꾸지 못한다', () => {
    // payload_json·idempotency_key가 바뀌면 "무엇을 보내기로 했는가"가 사라진다.
    expect(sql).toContain(
      'GRANT UPDATE (status, attempt_count, next_attempt_at) ON outbox_message',
    );
    expect(sql).toContain('REVOKE UPDATE ON outbox_message FROM une_worker');
  });

  it('세 테이블이 같은 마이그레이션에서 정책을 받는다', () => {
    for (const table of ['dispatch', 'dispatch_recipient', 'outbox_attempt']) {
      expect(sql, table).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql, table).toContain(`CREATE POLICY p_${table}_tenant ON ${table}`);
    }
  });

  it('channel_delivery를 만들지 않았고 그 이유가 적혀 있다', () => {
    const created = MIGRATION_FILES.some((name) =>
      readFileSync(join(MIGRATIONS_DIR, name), 'utf8').includes(
        'CREATE TABLE IF NOT EXISTS channel_delivery',
      ),
    );
    expect(created).toBe(false);
    expect(sql).toContain('channel_delivery');
  });
});
