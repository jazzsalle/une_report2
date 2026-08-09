import type { PoolClient } from 'pg';

/**
 * 보존기간 정리의 SQL 경계 (ADR-27 D1).
 *
 * 워커의 다른 파이프라인(`plan-toc`, `plan-content`, `document-export`,
 * `plan-jobs`)이 모두 SQL을 리포지토리로 분리해 두었고 이 모듈만 예외였다.
 * 러너는 "무엇을 언제 비우는가"를, 여기는 "어떻게 비우는가"를 담는다.
 *
 * 세 함수 모두 `withRetentionScope` 안에서만 불린다 — 접속 롤이
 * `une_retention`이고 `app.tenant_id`가 세워지지 않은 트랜잭션이다.
 */

/** 0026 §1의 CHECK와 0027의 허용 전이가 요구하는 마스킹 값. 문자열이 아니라 이 값이어야 한다. */
export const REDACTED_PAYLOAD = '{"redacted": true}';

/** 지금 기준의 만료 경계. 로그·증거에 남기기 위해 문자열로 받는다. */
export async function selectCutoff(c: PoolClient, days: number): Promise<string> {
  const row = await c.query(`SELECT (now() - make_interval(days => $1::int))::text AS cutoff`, [
    days,
  ]);
  return row.rows[0].cutoff as string;
}

/**
 * 아직 비우지 못한 만료분이 얼마나 남았는가.
 *
 * 배치 상한(기본 500행 × 6시간 = 하루 2,000행)보다 유입이 많으면 백로그가
 * 계속 자라는데, 건수만 찍으면 "이번에 몇 건 비웠나"만 보이고 **잔량은 보이지
 * 않는다.** 0026 §1의 부분 인덱스(`WHERE redacted_at IS NULL`)를 그대로 타므로
 * 비용은 만료분 범위로 제한된다.
 */
export async function countRemaining(
  c: PoolClient,
  days: number,
): Promise<{ providerResults: number; providerJobs: number }> {
  const row = await c.query(
    `SELECT
       (SELECT count(*)::int FROM provider_result
         WHERE redacted_at IS NULL AND received_at < now() - make_interval(days => $1::int)) AS results,
       (SELECT count(*)::int FROM provider_job
         WHERE redacted_at IS NULL AND created_at < now() - make_interval(days => $1::int)) AS jobs`,
    [days],
  );
  return {
    providerResults: row.rows[0].results as number,
    providerJobs: row.rows[0].jobs as number,
  };
}

/**
 * 만료된 Provider 응답 원문을 비운다.
 *
 * `redacted_at IS NULL`이 술어에 있으므로 이미 비운 행을 다시 만지지 않는다 —
 * 만지면 `redacted_at`이 매 실행마다 오늘로 밀려 "언제 비웠는가"가 사라진다.
 * (0027의 트리거도 같은 전이를 거부하므로 술어가 빠지면 스윕이 실패한다.)
 *
 * **`FOR UPDATE SKIP LOCKED`가 필요한 이유** — 워커의 다른 네 파이프라인과
 * 같은 형태다. `main.ts`가 기동 즉시 한 번 스윕하므로 레플리카 둘이 같이 뜨면
 * **부팅마다** 같은 행 집합을 만난다. 술어만으로는 막지 못한다: 두 트랜잭션이
 * 각각 `redacted_at IS NULL`을 읽은 뒤 순서대로 커밋하면 나중 것이 앞의
 * `redacted_at`을 오늘로 덮는다(0027 이전 실측으로 확인했다). 0027의 트리거가
 * 그 손상 자체는 막지만, 그때는 **그 주기의 배치가 통째로 롤백**되고 남는 것은
 * 42501 로그 한 줄뿐이다 — OB-17의 42501과 구분되지 않는다.
 *
 * SKIP LOCKED면 두 스윕이 서로 다른 행 집합을 집어 둘 다 전진한다.
 */
export async function redactExpiredResults(
  c: PoolClient,
  days: number,
  limit: number,
): Promise<number> {
  const res = await c.query(
    `UPDATE provider_result
     SET raw_payload_json = $1::jsonb, redacted_at = now()
     WHERE provider_result_id IN (
       SELECT provider_result_id FROM provider_result
       WHERE redacted_at IS NULL AND received_at < now() - make_interval(days => $2::int)
       ORDER BY received_at
       LIMIT $3
       FOR UPDATE SKIP LOCKED
     )`,
    [REDACTED_PAYLOAD, days, limit],
  );
  return res.rowCount ?? 0;
}

/** 만료된 사용자 조회조건을 비운다. 주소·성명이 들어오는 경로가 이 필드다. */
export async function redactExpiredJobs(
  c: PoolClient,
  days: number,
  limit: number,
): Promise<number> {
  const res = await c.query(
    `UPDATE provider_job
     SET request_json = $1::jsonb, redacted_at = now()
     WHERE provider_job_id IN (
       SELECT provider_job_id FROM provider_job
       WHERE redacted_at IS NULL AND created_at < now() - make_interval(days => $2::int)
       ORDER BY created_at
       LIMIT $3
       FOR UPDATE SKIP LOCKED
     )`,
    [REDACTED_PAYLOAD, days, limit],
  );
  return res.rowCount ?? 0;
}
