import { describe, expect, it } from 'vitest';
import type { ObjectStoragePort } from '@une/provider-adapters';
import { HealthController } from './health.controller';
import type { DatabaseService } from '../db/database.service';

/**
 * CC-430: liveness는 의존성을 보지 않는다.
 *
 * 그래서 여기서는 의존성을 **던지는 것**으로 주입한다 — live가 그것을 건드리면
 * 이 시험이 터진다. readiness의 동작은 관측성 e2e가 실제 DB·저장소로 본다.
 */
const explodingDb = {
  ping: () => {
    throw new Error('liveness must not touch the database');
  },
} as unknown as DatabaseService;

const explodingStorage = {
  head: () => {
    throw new Error('liveness must not touch object storage');
  },
} as unknown as ObjectStoragePort;

describe('HealthController', () => {
  it('reports ok with service name and ISO timestamp', () => {
    const report = new HealthController(explodingDb, explodingStorage).health();
    expect(report.status).toBe('ok');
    expect(report.service).toBe('une-api');
    expect(() => new Date(report.timestamp).toISOString()).not.toThrow();
  });

  it('live와 health는 같은 답을 준다', () => {
    const controller = new HealthController(explodingDb, explodingStorage);
    expect(controller.live().status).toBe(controller.health().status);
  });

  it('readiness는 의존성이 죽으면 degraded다', async () => {
    const report = await new HealthController(explodingDb, explodingStorage).ready();
    expect(report.status).toBe('degraded');
    expect(report.checks.every((c) => !c.ok)).toBe(true);
    // 운영자가 읽을 사유가 남아야 한다.
    for (const check of report.checks) expect(check.error).toBeTruthy();
  });
});
