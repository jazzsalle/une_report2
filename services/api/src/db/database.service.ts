import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { API_CONFIG, type ApiConfig } from '../config/api-config';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {
    this.pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Runs fn inside one transaction scoped to the tenant. RLS policies read
   * app.tenant_id (une_current_tenant_id()); set_config(..., true) is
   * transaction-local, so the scope dies with the transaction and pooled
   * connections never leak a tenant. Repositories additionally keep explicit
   * tenant predicates / parent-aggregate joins (ADR-21 compensating control
   * for the child tables RLS does not cover).
   */
  async withTenant<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!UUID_RE.test(tenantId)) {
      // Callers only pass DB-confirmed or signature-verified tenant ids;
      // anything else is a programming error, not a user error.
      throw new Error('withTenant requires a UUID tenantId');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (this.config.runtimeRole) {
        // Identifier validated in loadApiConfig; lets admin-URL test runs
        // exercise RLS as the runtime role (production connects as une_app).
        await client.query(`SET LOCAL ROLE ${this.config.runtimeRole}`);
      }
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
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
