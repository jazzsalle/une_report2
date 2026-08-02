import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

/** generated_block API-side access (CC-130, ADR-27). Reads/protection only —
 * generation writes belong to the worker. All queries run in a tenant
 * transaction (0017 EXISTS-parent FORCE RLS). */

export interface CurrentBlockLite {
  blockId: string;
  nodeKey: string;
  protectionState: string;
}

@Injectable()
export class GeneratedBlockRepository {
  async hasCurrentBlocks(client: PoolClient, planId: string): Promise<boolean> {
    const result = await client.query(
      `SELECT 1 FROM generated_block WHERE plan_id = $1 AND superseded_at IS NULL LIMIT 1`,
      [planId],
    );
    return result.rows.length > 0;
  }

  async findCurrentByIds(
    client: PoolClient,
    planId: string,
    blockIds: readonly string[],
  ): Promise<CurrentBlockLite[]> {
    const result = await client.query(
      `SELECT block_id, node_key, protection_state
       FROM generated_block
       WHERE plan_id = $1 AND superseded_at IS NULL AND block_id = ANY($2::uuid[])`,
      [planId, blockIds],
    );
    return result.rows.map((row) => ({
      blockId: row.block_id as string,
      nodeKey: row.node_key as string,
      protectionState: row.protection_state as string,
    }));
  }

  /** protectedBlockIds are PERSISTED as USER_LOCKED at request time (ADR-27
   * D4): protection must not depend on the client repeating itself on the
   * next regeneration. une_app may write protection_state (the 0017 trigger
   * restricts une_worker only). */
  async markProtected(
    client: PoolClient,
    planId: string,
    blockIds: readonly string[],
  ): Promise<number> {
    const result = await client.query(
      `UPDATE generated_block
       SET protection_state = 'USER_LOCKED', updated_at = now()
       WHERE plan_id = $1 AND superseded_at IS NULL AND block_id = ANY($2::uuid[])
         AND protection_state = 'NONE'`,
      [planId, blockIds],
    );
    return result.rowCount ?? 0;
  }
}
