import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  APPROVAL_LOCKED_STATUSES,
  ensureUserNodeKeys,
  flattenTocTree,
  nextStatusOnTocConfirm,
  tocTreeContentHash,
  validateTocTree,
  type TocNodeDraft,
} from '@une/domain';
import { AuditRepository } from '../common/audit.repository';
import type { AuthContext } from '../common/request-context';
import { DatabaseService } from '../db/database.service';
import { GenerationJobRepository } from './generation-job.repository';
import { PlanRepository } from './plan.repository';
import { planErrors, type RequestMeta } from './plan.service';
import { tocErrors } from './toc-errors';
import {
  TocVersionRepository,
  type TocNodeRow,
  type TocVersionRow,
} from './toc-version.repository';

/** Contract TocNodeResource / TocVersionResource. */
export interface TocNodeResource {
  nodeKey: string;
  title: string;
  level: number;
  sortOrder: number;
  generationPolicy: Record<string, unknown>;
  children: TocNodeResource[];
}

export interface TocVersionResource {
  tocVersionId: string;
  planId: string;
  versionNo: number;
  sourceType: string;
  baseSnapshotId: string;
  status: string;
  contentHash: string;
  createdBy: string;
  createdAt: string;
  nodes: TocNodeResource[];
}

/** Contract TocTreeNodeInput (already shape-validated by the controller). */
export interface TocTreeNodeInput {
  nodeKey?: string;
  title: string;
  generationPolicy?: Record<string, unknown>;
  children?: TocTreeNodeInput[];
}

export interface TocVersionSaveBody {
  baseVersionId: string;
  tocTree: TocTreeNodeInput[];
  confirm: boolean;
}

/** Saving without confirming leaves the plan in review (SCR-PLAN-006). */
const STATUS_ON_TOC_SAVE = 'OUTLINE_REVIEW';

function toDrafts(nodes: readonly TocTreeNodeInput[]): TocNodeDraft[] {
  return nodes.map((node) => ({
    ...(node.nodeKey !== undefined ? { nodeKey: node.nodeKey } : {}),
    title: node.title,
    ...(node.generationPolicy !== undefined ? { generationPolicy: node.generationPolicy } : {}),
    children: toDrafts(node.children ?? []),
  }));
}

/** Rebuilds the nested resource from the flat toc_node rows via
 * parent_node_id. Rows arrive ordered by (level, sort_order) so a parent is
 * always registered before its children. */
export function assembleTocTree(rows: readonly TocNodeRow[]): TocNodeResource[] {
  const byId = new Map<string, TocNodeResource>();
  const roots: TocNodeResource[] = [];
  const orphans: TocNodeResource[] = [];
  for (const row of rows) {
    const node: TocNodeResource = {
      nodeKey: row.nodeKey,
      title: row.title,
      level: row.level,
      sortOrder: row.sortOrder,
      generationPolicy: row.generationPolicy,
      children: [],
    };
    byId.set(row.tocNodeId, node);
    if (row.parentNodeId === null) {
      roots.push(node);
      continue;
    }
    const parent = byId.get(row.parentNodeId);
    if (parent) parent.children.push(node);
    // A parent outside the version is impossible (fk_toc_node_parent +
    // single-version insert); keep the node visible rather than dropping it.
    else orphans.push(node);
  }
  const sort = (list: TocNodeResource[]): void => {
    list.sort((a, b) => a.sortOrder - b.sortOrder);
    for (const node of list) sort(node.children);
  };
  const result = [...roots, ...orphans];
  sort(result);
  return result;
}

function toVersionResource(row: TocVersionRow, nodes: TocNodeResource[]): TocVersionResource {
  return {
    tocVersionId: row.tocVersionId,
    planId: row.planId,
    versionNo: row.versionNo,
    sourceType: row.sourceType,
    baseSnapshotId: row.baseSnapshotId,
    status: row.status,
    contentHash: row.contentHash,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    nodes,
  };
}

/** UNE-PLAN-014 / UNE-PLAN-015. A TOC version is immutable: an edit is always
 * a new version row, never an update of the previous one. */
@Injectable()
export class TocVersionService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(PlanRepository) private readonly plans: PlanRepository,
    @Inject(TocVersionRepository) private readonly versions: TocVersionRepository,
    @Inject(GenerationJobRepository) private readonly jobs: GenerationJobRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  /** UNE-PLAN-014. */
  async saveVersion(
    auth: AuthContext,
    planId: string,
    body: TocVersionSaveBody,
    meta: RequestMeta,
  ): Promise<TocVersionResource> {
    // Keying first means server-issued keys are always well-formed; only
    // client-supplied keys can still be rejected.
    const drafts = ensureUserNodeKeys(toDrafts(body.tocTree));
    const issues = validateTocTree(drafts);
    if (issues.length > 0) throw tocErrors.treeInvalid(issues);
    const flat = flattenTocTree(drafts);
    const contentHash = tocTreeContentHash(drafts);

    return this.db.withTenant(auth.tenantId, async (c) => {
      const plan = await this.plans.findPlan(c, auth.tenantId, planId, { forUpdate: true });
      if (!plan) throw planErrors.notFound();
      if (plan.deletedAt) {
        throw planErrors.preconditionFailed('휴지통의 계획서는 목차를 저장할 수 없습니다.');
      }
      if (APPROVAL_LOCKED_STATUSES.has(plan.status)) {
        throw planErrors.preconditionFailed(
          `현재 상태(${plan.status})에서는 목차를 저장할 수 없습니다.`,
        );
      }
      // User-edit protection (review B1): while a TOC job is active the
      // worker will repoint current_toc_version_id on completion — accepting
      // a user save now would let the AI result silently replace it
      // (CLAUDE.md: user-edited content is protected from regeneration).
      const active = await this.jobs.findActiveTocJob(c, auth.tenantId, planId);
      if (active) throw tocErrors.activeJobExists(active.jobId);
      // Optimistic concurrency for the outline: the client must have based its
      // edit on the plan's current version.
      if (plan.currentTocVersionId !== body.baseVersionId) {
        throw tocErrors.versionConflict(plan.currentTocVersionId);
      }
      const base = await this.versions.findVersionMeta(c, auth.tenantId, body.baseVersionId);
      if (!base || base.planId !== planId) throw tocErrors.versionNotFound();

      const versionNo = await this.versions.nextVersionNo(c, planId);
      const version = await this.versions.insertVersion(c, {
        planId,
        versionNo,
        sourceType: 'USER',
        // A user edit is still anchored to the AI version's base snapshot.
        baseSnapshotId: base.baseSnapshotId,
        status: body.confirm ? 'CONFIRMED' : 'DRAFT',
        contentHash,
        createdBy: auth.userId,
      });
      await this.versions.insertNodes(c, version.tocVersionId, flat);
      await this.plans.setCurrentTocVersion(
        c,
        auth.tenantId,
        planId,
        version.tocVersionId,
        body.confirm ? nextStatusOnTocConfirm() : STATUS_ON_TOC_SAVE,
      );
      await this.insertTocAudit(c, auth, meta, planId, {
        tocVersionId: version.tocVersionId,
        versionNo,
        sourceType: 'USER',
        confirmed: body.confirm,
      });
      const nodes = await this.versions.listNodes(c, auth.tenantId, version.tocVersionId);
      return toVersionResource(version, assembleTocTree(nodes));
    });
  }

  /** UNE-PLAN-015. */
  async getVersion(
    auth: AuthContext,
    planId: string,
    tocVersionId: string,
  ): Promise<TocVersionResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const version = await this.versions.findVersion(c, auth.tenantId, planId, tocVersionId);
      if (!version) throw tocErrors.versionNotFound();
      const nodes = await this.versions.listNodes(c, auth.tenantId, tocVersionId);
      return toVersionResource(version, assembleTocTree(nodes));
    });
  }

  private async insertTocAudit(
    client: PoolClient,
    auth: AuthContext,
    meta: RequestMeta,
    planId: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.insertAudit(client, {
      tenantId: auth.tenantId,
      actorId: auth.userId,
      action: 'TOC_VERSION_CREATED',
      resourceType: 'PLAN',
      resourceId: planId,
      correlationId: meta.correlationId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      detail,
    });
  }
}
