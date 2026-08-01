import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

export interface AuditEntry {
  tenantId: string;
  actorId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  correlationId: string;
  ip?: string;
  userAgent?: string;
  /** Pre-change values for mutations (audit_log.before_json). */
  before?: Record<string, unknown>;
  detail?: Record<string, unknown>;
}

/** audit_log is append-only for the runtime role (0011); corrections are new
 * events. Shared by auth, guards, and domain services (CC-110 lifted this out
 * of AuthRepository so domain services do not depend on the auth module). */
@Injectable()
export class AuditRepository {
  async insertAudit(client: PoolClient, entry: AuditEntry): Promise<void> {
    await client.query(
      `INSERT INTO audit_log
         (tenant_id, actor_id, action, resource_type, resource_id, correlation_id,
          ip_address, user_agent, before_json, after_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        entry.tenantId,
        entry.actorId ?? null,
        entry.action,
        entry.resourceType,
        entry.resourceId ?? null,
        entry.correlationId,
        entry.ip ?? null,
        entry.userAgent ?? null,
        entry.before ? JSON.stringify(entry.before) : null,
        entry.detail ? JSON.stringify(entry.detail) : null,
      ],
    );
  }
}
