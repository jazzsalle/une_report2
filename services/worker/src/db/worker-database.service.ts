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
