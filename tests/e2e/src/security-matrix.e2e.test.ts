import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listRoutes, type RegisteredRoute } from '@une/api';
import { ADMIN_URL, apiFor, startHarness, withClient, type Harness } from './harness';

/**
 * 보안 전수 매트릭스 (CC-430).
 *
 * 지금까지의 보안 시험은 **항목마다 한두 경로**를 골라 막히는지 봤다. 그것이
 * 증명하는 것은 "고른 경로가 막힌다"이고, 증명하지 못하는 것은 **아무도 고르지
 * 않은 경로**다. 가드를 빠뜨린 라우트는 정확히 그 자리에 생긴다 — 새 컨트롤러를
 * 쓰면서 `@RequirePermission`을 안 붙이면 인증만 있으면 누구나 부른다.
 *
 * 그래서 여기서는 **런타임 라우터가 실제로 등록한 것 전부**를 훑는다. 정규식으로
 * 소스를 읽지 않는 이유는 그것이 등록된 것이 아니라 적힌 것을 보기 때문이다.
 *
 * 세 갈래를 전수로 묻는다.
 *
 *   (1) 토큰 없이 부르면 401인가. `@Public`으로 표시된 것만 예외다.
 *   (2) 권한이 선언된 라우트를 **그 권한 없는 사용자**가 부르면 403인가.
 *   (3) 상태를 바꾸는 라우트에 멱등 키 선언이 있는가.
 *
 * 본문·경로 파라미터를 채우지 않으므로 통과 경로의 성공을 시험하지는 않는다.
 * 그것은 각 슬라이스 e2e의 몫이다. 여기서 시험하는 것은 **가드가 본문보다 먼저
 * 선다**는 것이고, 그래서 더미 파라미터로 충분하다 — 401/403은 본문 검증
 * 이전에 나야 한다. 400이 먼저 나오면 그 자체가 결함이다(권한 없는 사용자가
 * 요청 형식을 탐색할 수 있다).
 */

/** 더미 UUID — 경로 파라미터 자리를 채운다. 존재하지 않는 자원이어도 좋다. */
const DUMMY = '00000000-0000-4000-8000-000000000000';

/** `:id` → 더미 UUID, `*` 등 나머지는 그대로 둔다. */
function fillParams(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, DUMMY);
}

describe.skipIf(!ADMIN_URL)('보안 전수 매트릭스 (CC-430)', () => {
  let h: Harness;
  let api: ReturnType<typeof apiFor>;
  let routes: RegisteredRoute[];
  /** 권한이 거의 없는 사용자 — 403 경계의 반대편. */
  let readerToken: string;
  /** 다른 기관. 테넌트 경계의 반대편. */
  let otherToken: string;
  let readerPermissions: Set<string>;

  beforeAll(async () => {
    h = await startHarness('cc430_sec');
    api = apiFor(h);
    readerToken = await api.login(h.fixtures.tenantA, 'reader-a');
    otherToken = await api.login(h.fixtures.tenantB, 'user-b');

    // 읽기 전용 사용자가 실제로 가진 권한을 **DB에서** 읽는다. 하네스의
    // 고정값을 여기 다시 적으면 두 벌이 되고, 갈라지는 날 이 시험이 조용히
    // 약해진다.
    readerPermissions = await withClient(h.dbUrl, async (c) => {
      const r = await c.query(
        `SELECT DISTINCT p.permission_code
           FROM app_user u
           JOIN user_role ur ON ur.user_id = u.user_id
           JOIN role_permission rp ON rp.role_id = ur.role_id
           JOIN permission p ON p.permission_id = rp.permission_id
          WHERE u.user_id = $1`,
        [h.fixtures.readerA],
      );
      return new Set(r.rows.map((row: { permission_code: string }) => row.permission_code));
    });

    routes = listRoutes(h.app);
  }, 180_000);

  afterAll(async () => {
    await h?.close();
  });

  it('라우트를 실제로 찾았다 — 못 찾으면 뒤의 단언이 전부 공회전한다', () => {
    // 이 단언이 없으면 수집이 0건일 때 아래 전수 시험이 **아무것도 하지 않고
    // 통과한다.** CC-310 이중검토가 찾은 vacuous 단언과 같은 계열이다.
    expect(routes.length).toBeGreaterThan(50);
    expect(routes.some((r) => r.permission !== null)).toBe(true);
    expect(routes.some((r) => r.isPublic)).toBe(true);
  });

  it('(1) 토큰 없이 부르면 401이다 — @Public만 예외다', async () => {
    const leaks: string[] = [];
    for (const route of routes) {
      if (route.isPublic) continue;
      const res = await api.call(route.method, fillParams(route.path), null, {
        body: route.method === 'GET' || route.method === 'DELETE' ? undefined : {},
      });
      // 401이 아니면 인증 가드를 지나쳤다는 뜻이다. 404도 안 된다 — 존재
      // 여부를 인증 없이 알려 주는 것 자체가 정보다.
      if (res.status !== 401) {
        leaks.push(`${route.method} ${route.path} → ${res.status} (${route.handler})`);
      }
    }
    expect(leaks, `인증 없이 401이 아닌 라우트:\n${leaks.join('\n')}`).toEqual([]);
  }, 300_000);

  it('(2) 권한이 선언된 라우트는 그 권한 없는 사용자에게 403이다', async () => {
    const leaks: string[] = [];
    for (const route of routes) {
      if (route.isPublic || !route.permission) continue;
      if (readerPermissions.has(route.permission)) continue;

      const res = await api.call(route.method, fillParams(route.path), readerToken, {
        body: route.method === 'GET' || route.method === 'DELETE' ? undefined : {},
        idempotencyKey: route.idempotent ? `sec-${DUMMY}` : undefined,
      });
      // **403이 본문 검증보다 먼저 서야 한다.** 400이 먼저 나오면 권한 없는
      // 사용자가 요청 형식을 탐색할 수 있고, 404가 먼저 나오면 자원의 존재
      // 여부가 샌다.
      if (res.status !== 403) {
        leaks.push(
          `${route.method} ${route.path} [${route.permission}] → ${res.status} (${route.handler})`,
        );
      }
    }
    expect(leaks, `권한 없이 403이 아닌 라우트:\n${leaks.join('\n')}`).toEqual([]);
  }, 300_000);

  it('(3) 다른 기관의 토큰도 같은 자리에서 막힌다', async () => {
    // 테넌트 경계는 저장소 술어와 RLS가 지킨다. 여기서 확인하는 것은 **그
    // 이전에 인증·권한이 서고**, 남의 자원 UUID를 넣어도 200이 나오지 않는다는
    // 것이다. 더미 UUID이므로 정상 응답이 나오면 그 자체가 결함이다.
    const leaks: string[] = [];
    for (const route of routes) {
      if (route.isPublic) continue;
      if (!route.path.includes(':')) continue; // 자원을 가리키지 않는 라우트

      const res = await api.call(route.method, fillParams(route.path), otherToken, {
        body: route.method === 'GET' || route.method === 'DELETE' ? undefined : {},
        idempotencyKey: route.idempotent ? `sec-other-${DUMMY}` : undefined,
      });
      if (res.status >= 200 && res.status < 300) {
        leaks.push(`${route.method} ${route.path} → ${res.status} (${route.handler})`);
      }
    }
    expect(leaks, `남의 자원 UUID로 2xx가 난 라우트:\n${leaks.join('\n')}`).toEqual([]);
  }, 300_000);

  it('(4) 멱등 키 없는 POST는 **다른 보호가 있는 것뿐**이다', () => {
    // "재시도 가능한 create/dispatch/export 요청은 멱등 키를 쓴다"(CLAUDE.md).
    // 그런데 전부는 아니다 — 편집 계열은 Revision·ETag·ChangeSet 낙관 잠금이
    // 같은 일을 더 정확하게 한다(같은 규칙의 다음 줄). 조회성 POST와 본래
    // 멱등인 연산도 있다.
    //
    // 그래서 목록을 **사유와 함께 고정한다.** 새 POST가 멱등 키 없이 생기면
    // 여기서 걸리고, 사람이 어느 쪽인지 판단해 넣어야 한다. 목록을 지우고
    // 통과시키는 것이 가장 쉬운 길이므로 사유를 함께 적게 만든다.
    const EXEMPT: Record<string, string> = {
      'POST /api/v1/auth/logout': '본래 멱등하다 — 이미 폐기된 토큰을 다시 폐기해도 같은 결과다.',
      'POST /api/v1/plans/:planId/context-drafts':
        '초안은 계획서당 하나다(uk_plan_context_draft_plan). 재전송은 같은 행을 덮어쓰는 upsert다.',
      'POST /api/v1/documents/:documentId/changesets':
        'If-Match(revision_no) + baseRevisionId 낙관 잠금. 두 번째 적용은 base가 움직여 409다 — 멱등 키보다 정확하다.',
      'POST /api/v1/documents/:documentId/revisions/:revisionId/restore':
        'If-Match 낙관 잠금. 되돌리기도 새 판을 만들므로 같은 보호를 받는다.',
      'POST /api/v1/documents/:documentId/autosaves':
        '자동저장은 고빈도 last-write-wins다. 멱등 키를 걸면 저장 자체가 막힌다. If-Match + baseRevisionId로 보호한다.',
      'POST /api/v1/sops/:sopId/validate':
        '조회성 연산이다 — 검증 보고서를 낼 뿐 상태를 바꾸지 않는다.',
    };

    const missing = routes
      .filter((r) => r.method === 'POST' && !r.isPublic && !r.idempotent)
      .map((r) => `${r.method} ${r.path}`);

    const unexpected = missing.filter((m) => EXEMPT[m] === undefined);
    expect(unexpected, `멱등 키도 대체 보호도 없는 POST:\n${unexpected.join('\n')}`).toEqual([]);

    // 목록이 낡지 않도록 반대 방향도 본다 — 사라진 라우트가 사유만 남기면
    // 다음 사람이 "이건 왜 여기 있지"를 되묻게 된다.
    const stale = Object.keys(EXEMPT).filter((k) => !missing.includes(k));
    expect(stale, `사라진 라우트의 예외가 남아 있다:\n${stale.join('\n')}`).toEqual([]);
  });

  it('(5) 권한을 선언하지 않은 라우트는 **의도된 것뿐**이다', () => {
    // `@RequirePermission` 없는 라우트는 "로그인만 하면 누구나"다. 그것이
    // 맞는 자리도 있다(내 정보, 내 임무 목록). 문제는 **새 컨트롤러를 쓰면서
    // 빠뜨린 경우**이고, 그것은 빠뜨린 사람 눈에는 보이지 않는다.
    //
    // (2)가 이것을 못 잡는다 — 권한 선언이 없으면 403 시험 대상에서 아예
    // 빠지기 때문이다. 그래서 목록으로 따로 고정한다.
    const AUTH_ONLY: Record<string, string> = {
      'POST /api/v1/auth/logout': '자기 세션을 닫는다. 권한으로 가를 것이 없다.',
      'GET /api/v1/auth/me': '자기 정보다.',
    };

    const authOnly = routes
      .filter((r) => !r.isPublic && r.permission === null)
      .map((r) => `${r.method} ${r.path}`);

    const unexpected = authOnly.filter((m) => AUTH_ONLY[m] === undefined);
    expect(
      unexpected,
      `권한 선언이 없는 라우트 — 의도한 것인지 판단해 목록에 넣으십시오:\n${unexpected.join('\n')}`,
    ).toEqual([]);

    const stale = Object.keys(AUTH_ONLY).filter((k) => !authOnly.includes(k));
    expect(stale, `사라진 라우트의 예외가 남아 있다:\n${stale.join('\n')}`).toEqual([]);
  });
});
