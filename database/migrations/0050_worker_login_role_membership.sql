-- ===========================================================================
-- 0050. 워커 전용 로그인 롤에 멤버십을 준다 (OB-17, ADR-47 D3)
-- ===========================================================================
--
-- **배포 전 차단 항목이었다.**
--
-- 워커는 매 트랜잭션에서 `SET LOCAL ROLE une_worker`(또는 보존 스윕에서
-- `une_retention`)를 한다. 그런데 `une_app`은 둘 중 어느 쪽으로도 `SET ROLE`할
-- 수 없다(42501, 실측). `infrastructure/initdb/01-app-role.sh`는 `une_app`만
-- 만들고, `une_worker`(0015)·`une_retention`(0026)은 마이그레이션이 NOLOGIN으로
-- 만드는데, **그 사이를 잇는 GRANT가 저장소 어디에도 없었다** — initdb·compose·
-- CI·스크립트 전부. 0015부터의 선재 결함이며, 테스트가 superuser로 접속해
-- 강등하기 때문에 드러나지 않았다.
--
-- 결과: `services/worker/.env.example`대로 워커를 띄우면 첫 트랜잭션이 42501로
-- 죽고, 보존 스윕은 한 번도 돌지 않아 제공자 원문이 무기한 남는다.
--
-- ---------------------------------------------------------------------------
-- 왜 `une_app`에 주지 않는가
-- ---------------------------------------------------------------------------
-- `GRANT une_retention TO une_app`으로 닫으면 안 된다. 기본 `INHERIT`가 정책
-- 대상 자격까지 물려줘 **API 런타임이 전 테넌트 원문을 보게 된다** — ADR-35
-- D2/D4가 세운 경계가 그대로 무너진다(ADR-35 수용 한계 4).
--
-- 그래서 **워커 전용 로그인 롤**을 따로 둔다.
--
-- ---------------------------------------------------------------------------
-- `INHERIT FALSE, SET TRUE` (PG16)
-- ---------------------------------------------------------------------------
-- 로그인 롤이 두 롤의 권한을 **자동으로 물려받지 않는다**(`INHERIT FALSE`).
-- 명시적으로 `SET ROLE`할 때만 그 권한이 선다(`SET TRUE`). 워커 코드가 이미
-- 그렇게 쓰고 있고, 이렇게 두면 `SET ROLE`을 빼먹은 경로가 조용히 통과하지
-- 않고 권한 오류로 드러난다.
--
-- ---------------------------------------------------------------------------
-- 순서 문제
-- ---------------------------------------------------------------------------
-- initdb는 마이그레이션보다 **먼저** 돈다. 그래서 initdb가 대상 롤
-- (`une_worker`·`une_retention`)에 GRANT할 수는 없다 — 그때는 아직 없다.
-- 반대로 마이그레이션은 비밀번호를 다룰 수 없다(SQL에 남는다).
--
-- 그래서 갈랐다. **비밀번호와 LOGIN은 initdb가, 멤버십은 이 마이그레이션이**
-- 준다. 양쪽 순서 어디서 시작해도 같은 자리에 도착한다.
--
--   compose(fresh): initdb가 LOGIN 롤을 만든다 → 여기서 멤버십을 준다.
--   CI(initdb 없음): 여기서 NOLOGIN으로 만들고 멤버십을 준다. CI의 워커는
--                    superuser로 붙으므로 영향이 없고, 그래도 **GRANT가 실재하는지
--                    통합 테스트가 확인할 수 있다**.
--
-- 롤 이름은 상수 `une_worker_app`이다. 환경변수로 열면 마이그레이션이 환경에
-- 따라 다른 결과를 내고, 그러면 "적용됐는가"에 답이 둘이 된다.
--
-- 되돌리기: `REVOKE une_worker, une_retention FROM une_worker_app`. 롤 자체는
-- 남겨 둔다 — 지우면 그 롤이 소유한 것이 있을 때 실패한다.

-- ---------------------------------------------------------------------------
-- §1. 워커 전용 로그인 롤
-- ---------------------------------------------------------------------------
-- 없으면 만든다. **NOLOGIN으로 만든다** — 비밀번호 없는 LOGIN 롤은 접속 경로가
-- 열린 채로 남는다. LOGIN과 비밀번호는 initdb가 준다.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'une_worker_app') THEN
    CREATE ROLE une_worker_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- 외부에서 만들어졌더라도 RLS 우회 속성은 갖지 못하게 한다(0011 §1·0026과 같은 취지).
ALTER ROLE une_worker_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- ---------------------------------------------------------------------------
-- §2. 멤버십 — 물려받지 않고, 명시적으로 갈아입는다
-- ---------------------------------------------------------------------------
GRANT une_worker TO une_worker_app WITH INHERIT FALSE, SET TRUE;
GRANT une_retention TO une_worker_app WITH INHERIT FALSE, SET TRUE;

-- 스키마 사용 권한은 로그인 롤 자신에게도 필요하다. `SET ROLE` 이전의 세션이
-- 최소한 스키마를 볼 수 있어야 하고, 그 이상은 주지 않는다 — 테이블 권한은
-- 갈아입은 뒤에만 선다.
GRANT USAGE ON SCHEMA public TO une_worker_app;

COMMENT ON ROLE une_worker_app IS
  '워커 전용 로그인 롤 (OB-17). une_worker·une_retention의 멤버이나 INHERIT FALSE라 SET ROLE 없이는 아무 권한도 서지 않는다. 비밀번호와 LOGIN은 initdb가 준다.';

-- ---------------------------------------------------------------------------
-- §3. 적용 확인 — 조용히 빠지지 않는다
-- ---------------------------------------------------------------------------
-- 이 마이그레이션의 목적은 GRANT 두 줄이다. 어떤 이유로든 그것이 서지 않았으면
-- 여기서 멈춘다 — "적용됐다"는 기록만 남고 워커는 여전히 42501로 죽는 상태가
-- 가장 나쁘다.
DO $$
DECLARE
  granted int;
BEGIN
  SELECT count(*) INTO granted
    FROM pg_auth_members m
    JOIN pg_roles member ON member.oid = m.member
    JOIN pg_roles grantee ON grantee.oid = m.roleid
   WHERE member.rolname = 'une_worker_app'
     AND grantee.rolname IN ('une_worker', 'une_retention')
     AND m.set_option;
  IF granted <> 2 THEN
    RAISE EXCEPTION
      'une_worker_app이 une_worker·une_retention을 SET ROLE할 수 없다 (%건만 성립). OB-17이 닫히지 않았다.', granted
      USING ERRCODE = '42501';
  END IF;
END
$$;
