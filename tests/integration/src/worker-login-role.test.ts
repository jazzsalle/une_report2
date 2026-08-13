import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { ADMIN_URL, createTestDb, dropTestDb, migrate, withClient } from './db-helpers';

/**
 * 마이그레이션 0050: 워커 전용 로그인 롤의 멤버십 (OB-17).
 *
 * **배포 전 차단 항목이었다.** 워커는 매 트랜잭션에서 `SET LOCAL ROLE une_worker`
 * (보존 스윕에서는 `une_retention`)를 하는데, 그 `SET ROLE`을 할 수 있는 로그인
 * 롤이 저장소 어디에도 프로비저닝되지 않았다 — initdb·마이그레이션·compose·CI
 * 전부. 0015부터의 선재 결함이며, 테스트가 superuser로 접속해 강등하기 때문에
 * 드러나지 않았다.
 *
 * 여기서 고정하는 것은 **권한 그 자체**다. 워커의 동작은 워커 e2e가 증명한다.
 *
 *   (1) `une_worker_app`이 두 롤로 갈아입을 수 있다 — 이것이 닫혔다는 증거다.
 *   (2) 갈아입기 **전에는** 아무 권한도 서지 않는다(`INHERIT FALSE`).
 *       빼먹은 경로가 조용히 통과하지 않아야 한다.
 *   (3) `une_app`은 여전히 두 롤로 갈아입을 수 없다 — 이것이 열리면 API
 *       런타임이 전 테넌트 원문을 보게 된다(ADR-35 D2/D4).
 *   (4) 로그인 롤은 RLS를 우회하지 못한다.
 */

const LOGIN_ROLE = 'une_worker_app';
const TARGET_ROLES = ['une_worker', 'une_retention'] as const;

async function errCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'NO_ERROR';
  } catch (err) {
    return (err as { code?: string }).code ?? 'UNKNOWN';
  }
}

async function asRole<T>(url: string, role: string, fn: (c: Client) => Promise<T>): Promise<T> {
  return withClient(url, async (c) => {
    await c.query(`SET ROLE ${role}`);
    return fn(c);
  });
}

/**
 * 멤버십을 **카탈로그에 직접 묻는다.**
 *
 * `SET ROLE`을 시도해 보는 것으로는 증명되지 않는다 — 이 테스트는 superuser로
 * 접속하고, `SET ROLE` 권한은 **세션 사용자**를 기준으로 검사되므로 중간에
 * 무엇으로 갈아입었든 언제나 통과한다. 처음에 그렇게 썼더니 (1)과 (3)이 둘 다
 * 공회전했다.
 */
async function canSetRole(url: string, member: string, target: string): Promise<boolean> {
  return withClient(url, async (c) => {
    const r = await c.query(`SELECT pg_has_role($1, $2, 'SET') AS ok`, [member, target]);
    return (r.rows[0] as { ok: boolean }).ok;
  });
}

/** 권한을 **물려받는가** — `SET ROLE` 없이 서는가. */
async function inheritsRole(url: string, member: string, target: string): Promise<boolean> {
  return withClient(url, async (c) => {
    const r = await c.query(`SELECT pg_has_role($1, $2, 'USAGE') AS ok`, [member, target]);
    return (r.rows[0] as { ok: boolean }).ok;
  });
}

describe.skipIf(!ADMIN_URL)('0050: 워커 전용 로그인 롤 (OB-17)', () => {
  let dbName: string;
  let url: string;

  beforeAll(async () => {
    ({ name: dbName, url } = await createTestDb('ob17'));
    await migrate(url);
  }, 180_000);

  afterAll(async () => {
    if (dbName) await dropTestDb(dbName);
  });

  it('(1) une_worker_app이 une_worker·une_retention으로 갈아입을 수 있다', async () => {
    for (const target of TARGET_ROLES) {
      expect(
        await canSetRole(url, LOGIN_ROLE, target),
        `${LOGIN_ROLE}이 ${target}로 SET ROLE할 수 없다 — OB-17이 닫히지 않았다`,
      ).toBe(true);
      // 갈아입을 수는 있되 **물려받지는 않는다**(INHERIT FALSE).
      expect(
        await inheritsRole(url, LOGIN_ROLE, target),
        `${LOGIN_ROLE}이 ${target}를 물려받으면 SET ROLE을 빼먹은 경로가 조용히 돈다`,
      ).toBe(false);
    }
  });

  it('(2) 갈아입기 전에는 아무 권한도 서지 않는다 (INHERIT FALSE)', async () => {
    // `une_worker`로 갈아입어야만 큐를 볼 수 있다. 물려받았다면 여기서 통과하고,
    // 그러면 `SET ROLE`을 빼먹은 경로가 조용히 돈다.
    const withoutSetRole = await errCode(() =>
      asRole(url, LOGIN_ROLE, (c) => c.query(`SELECT 1 FROM generation_job LIMIT 1`)),
    );
    expect(withoutSetRole, 'SET ROLE 없이 큐가 보이면 INHERIT FALSE가 서지 않은 것이다').toBe(
      '42501',
    );

    // 갈아입으면 선다.
    const afterSetRole = await errCode(() =>
      asRole(url, LOGIN_ROLE, async (c) => {
        await c.query(`SET ROLE une_worker`);
        return c.query(`SELECT 1 FROM generation_job LIMIT 1`);
      }),
    );
    expect(afterSetRole).toBe('NO_ERROR');
  });

  it('(3) une_app은 여전히 두 롤과 무관하다', async () => {
    for (const target of TARGET_ROLES) {
      // 열리면 API 런타임이 전 테넌트 원문을 보게 된다 (ADR-35 D2/D4).
      expect(
        await canSetRole(url, 'une_app', target),
        `une_app이 ${target}로 갈아입을 수 있으면 경계가 무너진 것이다`,
      ).toBe(false);
      expect(
        await inheritsRole(url, 'une_app', target),
        `une_app이 ${target}를 물려받으면 API가 전 테넌트 원문을 본다`,
      ).toBe(false);
    }
  });

  it('(4) 로그인 롤은 RLS를 우회하지 못한다', async () => {
    const row = await withClient(url, async (c) => {
      const r = await c.query(
        `SELECT rolbypassrls, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin
           FROM pg_roles WHERE rolname = $1`,
        [LOGIN_ROLE],
      );
      return r.rows[0] as Record<string, boolean>;
    });
    expect(row.rolbypassrls).toBe(false);
    expect(row.rolsuper).toBe(false);
    expect(row.rolcreaterole).toBe(false);
    expect(row.rolcreatedb).toBe(false);
    // 마이그레이션은 NOLOGIN으로 만든다 — LOGIN과 비밀번호는 initdb가 준다.
    // 비밀번호 없는 LOGIN 롤이 남지 않아야 한다.
    expect(row.rolcanlogin).toBe(false);
  });
});
