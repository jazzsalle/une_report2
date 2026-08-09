import { Pool, type PoolClient } from 'pg';
import type { WorkerConfig } from '../config/worker-config';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Worker transaction scopes (ADR-25 D2):
 * - withDispatchScope: app.tenant_id UNSET — the une_worker dispatch policies
 *   apply, exposing QUEUED/RUNNING/CANCEL_REQUESTED jobs across tenants but
 *   forbidding terminal-state writes (WITH CHECK).
 * - withTenant: identical contract to services/api DatabaseService — RLS
 *   scopes every read/write to the job's tenant; terminal states are only
 *   writable here.
 * - withRetentionScope: 롤이 `une_worker`가 아니라 `une_retention`이고
 *   app.tenant_id를 세우지 않는다 (0026 §2·§4, OB-16). 전 테넌트가 보이는
 *   근거는 BYPASSRLS가 아니라 그 롤을 대상으로 하는 정책이며, 쓸 수 있는
 *   것은 컬럼 GRANT 네 개와 0027의 허용 전이 하나뿐이다.
 */
export class WorkerDatabase {
  private readonly pool: Pool;

  constructor(private readonly config: WorkerConfig) {
    this.pool = new Pool({ connectionString: config.databaseUrl, max: 5 });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async withDispatchScope<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.run(undefined, fn);
  }

  async withTenant<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!UUID_RE.test(tenantId)) {
      throw new Error('withTenant requires a UUID tenantId');
    }
    return this.run(tenantId, fn);
  }

  /**
   * 보존 정리 전용 롤로 한 트랜잭션을 연다 (0026 §2).
   *
   * `app.tenant_id`를 세우지 않는다 — 대상 롤을 향한 정책이 `USING (true)`라
   * 전 테넌트가 보이고, 테넌트를 세우면 오히려 한 테넌트만 정리된다.
   *
   * 롤을 인자로 받지 않는 이유: 받으면 `loadWorkerConfig`가 기동 시점에 막는
   * "보존 롤 = 워커 롤" 조합을 호출부가 우회할 수 있다. 설정에서 막은 것을
   * 코드에서 못 막으면 다음 러너가 그 문을 연다.
   */
  async withRetentionScope<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const role = this.config.retentionRole;
    // 두 겹 다 loadWorkerConfig가 이미 보장하지만, 이 메서드가 설정을 우회한
    // 경로로 불릴 가능성까지 여기서 닫는다.
    if (!/^[a-z_][a-z0-9_]*$/.test(role)) {
      throw new Error('withRetentionScope requires a plain SQL identifier role');
    }
    if (role === this.config.runtimeRole) {
      throw new Error(
        '보존 롤과 워커 롤이 같다 — ADR-33 D2(워커는 상황 계열 테이블에 닿지 않는다)가 뒤집힌다',
      );
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${role}`);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  private async run<T>(
    tenantId: string | undefined,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (this.config.runtimeRole) {
        // Identifier validated in loadWorkerConfig.
        await client.query(`SET LOCAL ROLE ${this.config.runtimeRole}`);
      }
      if (tenantId) {
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      }
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}
