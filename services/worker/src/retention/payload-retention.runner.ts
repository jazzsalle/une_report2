import type { PoolClient } from 'pg';
import type { WorkerConfig } from '../config/worker-config';
import type { WorkerDatabase } from '../db/worker-database.service';
import {
  countRemaining,
  redactExpiredJobs,
  redactExpiredResults,
  selectCutoff,
} from './retention.repository';

/**
 * Provider 원문·요청 조건의 보존기간 정리 (OB-16 종결).
 *
 * 0023이 두 가지를 영구 보존하게 만들었다 — Provider 응답 원문
 * (`provider_result.raw_payload_json`, CLAUDE.md 비협상 규칙)과 사용자가 채운
 * 조회조건(`provider_job.request_json`). 후자의 `query`는 형태가 정해지지 않은
 * 객체라 주소·성명이 들어올 수 있고, 두 테이블 모두 `une_app`에서
 * UPDATE/DELETE가 회수돼 있어 **사후에 가릴 방법이 없었다.**
 *
 * 사용자 결정(2026-08-09): **행을 지우지 않고 페이로드만 비운다.** 해시·
 * 항목수·시각·상태는 남는다 — 감사가 묻는 "무엇을 받았다고 주장하느냐"는
 * 그대로 답할 수 있고, 사라지는 것은 내용뿐이다.
 *
 * 실행 주체가 워커인 이유: 실행 사실이 애플리케이션 로그와 같은 자리에 남는다.
 * DB 스케줄러(pg_cron)에 넣으면 "언제 무엇이 지워졌는가"가 다른 곳에 남는다.
 *
 * **롤이 다르다.** `une_worker`가 아니라 `une_retention`으로 돈다 —
 * ADR-33 D2의 따름정리가 "워커는 상황 계열 테이블에 닿지 않는다"이고
 * `situation-table-rls.test.ts`가 그 42501을 회귀로 고정한다. 보존 작업을
 * 위해 워커 롤에 권한을 주면 그 결정이 조용히 뒤집힌다. 0026이 만든 전용
 * 롤은 **두 컬럼의 UPDATE와 SELECT만** 갖는다.
 */
export interface RetentionSweepResult {
  providerResults: number;
  providerJobs: number;
  cutoff: string;
  /** 이번 스윕 뒤에도 남은 만료분. 배치 상한보다 유입이 많으면 이 값이 자란다. */
  remainingResults: number;
  remainingJobs: number;
}

export class PayloadRetentionRunner {
  constructor(
    private readonly db: WorkerDatabase,
    private readonly config: WorkerConfig,
  ) {}

  /**
   * 만료분을 한 번 훑는다.
   *
   * 테넌트를 가리지 않는다 — 0026 §4가 `une_retention`을 대상으로 하는
   * 정책(`USING (true)`)을 따로 두었기 때문이며, `BYPASSRLS`가 아니라 정책이라
   * "왜 전부 보이는가"가 `pg_policies`에 드러난다.
   *
   * 한 번에 지우는 양을 제한한다(`batchSize`). 첫 실행이 수십만 행을 만나면
   * 한 트랜잭션이 테이블을 오래 잡고, 그동안 수집이 막힌다.
   */
  async sweep(): Promise<RetentionSweepResult> {
    const days = this.config.payloadRetentionDays;
    const limit = this.config.retentionBatchSize;
    return this.db.withRetentionScope(async (c: PoolClient) => {
      const cutoff = await selectCutoff(c, days);
      const providerResults = await redactExpiredResults(c, days, limit);
      const providerJobs = await redactExpiredJobs(c, days, limit);
      const remaining = await countRemaining(c, days);
      return {
        providerResults,
        providerJobs,
        cutoff,
        remainingResults: remaining.providerResults,
        remainingJobs: remaining.providerJobs,
      };
    });
  }
}
