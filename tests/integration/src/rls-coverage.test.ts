import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_URL, createTestDb, dropTestDb, migrate, withClient } from './db-helpers';

/**
 * RLS 커버리지 가드 (CC-250).
 *
 * **같은 사고가 네 번 났다.** 새 테이블을 만들면서 정책을 걸지 않아 전 테넌트
 * 공개가 된 것: 0023(상황 계열 여섯), 0031(근거 둘), 0032(SOP 셋), 그리고
 * CC-250 착수 시점의 `sop_validation`. 매번 "그 항목이 첫 쓰기 경로를 여는
 * 순간" 발견됐고, 그 사이 기간 동안 구멍은 열려 있었다.
 *
 * 실질 방어는 테이블 설계가 아니라 **절차**다: `CREATE TABLE`과 ENABLE/FORCE
 * RLS와 정책과 GRANT는 **같은 마이그레이션에서만** 온다. 이 테스트가 그 규칙을
 * 강제한다 — 정책 없는 테이블이 새로 생기면 여기서 먼저 빨개진다.
 *
 * 아래 목록은 **지금 열려 있는 것의 전수**다. 줄이는 것만 허용한다: 항목을
 * 지우려면 그 테이블에 정책을 걸면 되고, 항목을 **추가**하려면 왜 테넌트
 * 격리가 필요 없는지를 여기 적어야 한다.
 */

/**
 * 정책이 없어도 되는 테이블 — 테넌트 데이터가 아니다.
 *
 * 카탈로그(전 기관 공통 어휘)와 기관 자체 목록이다. 이들은 `tenant_id`가
 * 없거나(카탈로그) 자기 자신이 테넌트다.
 */
const TENANT_FREE: readonly string[] = [
  'permission', // 0012 RBAC 카탈로그 — 전 기관 공통
  'role_permission', // 카탈로그 결합
  'pgmigrations', // 마이그레이션 이력
];

/**
 * **아직 정책이 없는 테넌트 데이터 테이블.** 각 항목은 "그 도메인이 첫 쓰기
 * 경로를 열 때 닫는다"는 약속이고, 그 항목 없이 새로 추가되면 이 테스트가
 * 막는다.
 *
 * 여기 남아 있다는 것은 **지금 그 테이블이 전 테넌트 공개라는 뜻이다.**
 * 아직 쓰는 코드가 없어서 실질 노출이 없을 뿐이다 — 쓰기 시작하는 항목이
 * 반드시 함께 닫아야 한다.
 */
const KNOWN_OPEN: readonly string[] = [
  // 실행 계열 — CC-260(SopRun/Task)이 연다
  'sop_run',
  'task',
  'task_event',
  'task_attachment',
  // 전파 계열 — CC-270(Outbox/Dispatch)이 연다
  'dispatch',
  'dispatch_recipient',
  'outbox_attempt',
  // 일지 계열 — CC-280(Journal)이 연다
  'journal',
  'journal_projection_item',
  // 평가·개선 — CC-300대가 연다
  'evaluation',
  'evaluation_score',
  'improvement_action',
  // 계획 초안 — CC-1xx 잔여
  'plan_context_draft',
  // IAM 세션·역할배정 — 인증 경로가 자체 스코프를 건다(CC-100). 정책 도입은
  // 별도 판단이 필요하므로 목록에 남긴다.
  'user_role',
  'user_session',
];

describe.skipIf(!ADMIN_URL)('RLS 커버리지 — 정책 없는 테이블이 늘지 않는다', () => {
  let db: { name: string; url: string };
  let rows: Array<{ relname: string; rls: boolean; policies: number; appGranted: boolean }>;

  beforeAll(async () => {
    db = await createTestDb('rls_coverage');
    await migrate(db.url);
    const result = await withClient(db.url, (c) =>
      c.query(
        `SELECT c.relname,
                c.relrowsecurity AS rls,
                (SELECT count(*)::int FROM pg_policies p
                  WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies,
                EXISTS (SELECT 1 FROM information_schema.role_table_grants g
                         WHERE g.table_schema = 'public'
                           AND g.table_name = c.relname
                           AND g.grantee = 'une_app') AS app_granted
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
          ORDER BY c.relname`,
      ),
    );
    rows = result.rows.map((r) => ({
      relname: r.relname as string,
      rls: r.rls as boolean,
      policies: Number(r.policies),
      appGranted: r.app_granted as boolean,
    }));
  }, 180_000);

  afterAll(async () => {
    if (db) await dropTestDb(db.name);
  });

  it('정책이 없는 테이블은 알려진 목록 안에만 있다', () => {
    const uncovered = rows
      .filter((r) => r.policies === 0)
      .map((r) => r.relname)
      .filter((name) => !TENANT_FREE.includes(name));
    // 새 테이블이 정책 없이 들어오면 여기서 걸린다. 목록에 추가해 통과시키려면
    // 왜 테넌트 격리가 필요 없는지를 위 주석에 적어야 한다.
    expect([...uncovered].sort()).toEqual([...KNOWN_OPEN].sort());
  });

  it('알려진 목록이 낡지 않았다 (이미 닫힌 테이블이 남아 있지 않다)', () => {
    // 목록은 줄어들기만 해야 한다. 닫은 뒤 항목을 지우지 않으면 다음 사람이
    // "아직 열려 있다"고 잘못 읽는다.
    const stale = KNOWN_OPEN.filter((name) => {
      const row = rows.find((r) => r.relname === name);
      return row !== undefined && row.policies > 0;
    });
    expect(stale).toEqual([]);
  });

  it('CC-250이 연 세 테이블은 정책과 FORCE RLS를 갖는다', () => {
    for (const name of ['sop_validation', 'sop_review_request', 'sop_approval']) {
      const row = rows.find((r) => r.relname === name);
      expect(row, name).toBeDefined();
      expect(`${name}:policies=${row?.policies ?? 0}`).toBe(`${name}:policies=1`);
      expect(`${name}:rls=${row?.rls}`).toBe(`${name}:rls=true`);
    }
  });

  it('정책이 있는 테이블은 모두 FORCE다', () => {
    // FORCE가 없으면 테이블 소유자에게는 정책이 적용되지 않는다.
    const notForced = rows.filter((r) => r.policies > 0 && !r.rls).map((r) => r.relname);
    expect(notForced).toEqual([]);
  });
});
