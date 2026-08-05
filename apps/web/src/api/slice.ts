import type { components } from '../generated/une-platform-api';
import { ApiClient, newIdempotencyKey } from './client';

/**
 * Plan 수직 슬라이스가 실제로 호출하는 연산들 (CC-170).
 *
 * 타입은 계약에서 생성된 것을 쓴다(`src/generated`). 화면이 응답 모양을 손으로
 * 다시 적으면 계약이 바뀔 때 조용히 갈라지고, 그 드리프트는 사용자 화면에서만
 * 드러난다.
 */

type Schemas = components['schemas'];

export type FileRegistration = Schemas['FileRegistrationResource'];
export type FileObject = Schemas['FileObjectResource'];
export type ImportedDocument = Schemas['ImportedDocumentResource'];
export type DocumentAnalysis = Schemas['DocumentAnalysisResource'];
export type ExportJob = Schemas['ExportJobResource'];
export type PlanResource = Schemas['PlanResource'];
export type GenerationJob = Schemas['GenerationJobResource'];
export type TocVersion = Schemas['TocVersionResource'];

export interface UserContext {
  userId: string;
  tenantId: string;
  tenantName?: string;
  displayName?: string;
  roles?: { roleCode: string; roleName?: string }[];
  permissions?: string[];
}

/** 브라우저에서 SHA-256. 사전등록은 이 값을 선언하고 서버가 저장 바이트로 재계산한다. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class SliceApi {
  constructor(private readonly client: ApiClient) {}

  // ── 인증 (UNE-AUTH-001/002) ────────────────────────────────────────────
  async exchange(externalToken: string): Promise<{ accessToken: string; expiresIn: number }> {
    const { data } = await this.client.call<{ accessToken: string; expiresIn: number }>(
      '/auth/sso/exchange',
      { method: 'POST', body: { externalToken } },
    );
    this.client.setToken(data.accessToken);
    return data;
  }

  async me(): Promise<UserContext> {
    return (await this.client.call<UserContext>('/auth/me')).data;
  }

  // ── 계획서 (UNE-PLAN-001/002/006/007) ──────────────────────────────────
  async createPlan(input: {
    title: string;
    hazardType: string;
    managementPhase: string;
    startMode: string;
  }): Promise<PlanResource> {
    return (
      await this.client.call<PlanResource>('/plans', {
        method: 'POST',
        body: input,
        idempotencyKey: newIdempotencyKey('plan'),
      })
    ).data;
  }

  async listPlans(): Promise<{ items: PlanResource[]; totalElements: number }> {
    return (
      await this.client.call<{ items: PlanResource[]; totalElements: number }>(
        '/plans?page=1&size=20',
      )
    ).data;
  }

  async saveContextDraft(planId: string, context: Record<string, unknown>): Promise<unknown> {
    return (
      await this.client.call(`/plans/${planId}/context-drafts`, {
        method: 'POST',
        body: { context },
        idempotencyKey: newIdempotencyKey('draft'),
      })
    ).data;
  }

  /**
   * UNE-PLAN-007. 임시저장(006)과 달리 **기준정보를 본문 최상위로** 보낸다 —
   * 계약이 그렇게 갈려 있다(006은 `{context}`, 007은 컨텍스트 자체). 감싸서
   * 보내면 엄격 검증이 필수 필드를 못 찾아 422다.
   */
  async confirmSnapshot(
    planId: string,
    context: Record<string, unknown>,
  ): Promise<{ contextSnapshotId: string; versionNo: number }> {
    return (
      await this.client.call<{ contextSnapshotId: string; versionNo: number }>(
        `/plans/${planId}/context-snapshots`,
        {
          method: 'POST',
          body: context,
          idempotencyKey: newIdempotencyKey('snap'),
        },
      )
    ).data;
  }

  // ── 업로드 3단 + 반입 (UNE-DOC-001~004) ────────────────────────────────
  async registerFile(input: {
    fileName: string;
    sizeBytes: number;
    mimeType: string;
    sha256: string;
  }): Promise<FileRegistration> {
    return (
      await this.client.call<FileRegistration>('/files', {
        method: 'POST',
        body: { ...input, purpose: 'HWPX_IMPORT' },
        idempotencyKey: newIdempotencyKey('file'),
      })
    ).data;
  }

  async completeFile(fileId: string, etag?: string): Promise<FileObject> {
    return (
      await this.client.call<FileObject>(`/files/${fileId}/complete`, {
        method: 'POST',
        body: etag ? { etag } : {},
        idempotencyKey: newIdempotencyKey('complete'),
      })
    ).data;
  }

  async importHwpx(input: {
    fileId: string;
    planId?: string;
    title?: string;
  }): Promise<ImportedDocument> {
    return (
      await this.client.call<ImportedDocument>('/documents/import-hwpx', {
        method: 'POST',
        body: input,
        idempotencyKey: newIdempotencyKey('import'),
      })
    ).data;
  }

  async analysis(documentId: string): Promise<DocumentAnalysis> {
    return (await this.client.call<DocumentAnalysis>(`/documents/${documentId}/analysis`)).data;
  }

  // ── 생성 Job (UNE-PLAN-009/010/016) ────────────────────────────────────
  async startTocJob(planId: string, contextSnapshotId: string): Promise<GenerationJob> {
    return (
      await this.client.call<GenerationJob>(`/plans/${planId}/toc-jobs`, {
        method: 'POST',
        body: { contextSnapshotId },
        idempotencyKey: newIdempotencyKey('toc'),
      })
    ).data;
  }

  async startContentJob(
    planId: string,
    input: { contextSnapshotId: string; tocVersionId: string },
  ): Promise<GenerationJob> {
    return (
      await this.client.call<GenerationJob>(`/plans/${planId}/content-jobs`, {
        method: 'POST',
        body: input,
        idempotencyKey: newIdempotencyKey('content'),
      })
    ).data;
  }

  async job(jobId: string): Promise<GenerationJob> {
    return (await this.client.call<GenerationJob>(`/plan-jobs/${jobId}`)).data;
  }

  async cancelJob(jobId: string): Promise<GenerationJob> {
    return (
      await this.client.call<GenerationJob>(`/plan-jobs/${jobId}/cancel`, {
        method: 'POST',
        body: { reason: '사용자 중지' },
        idempotencyKey: newIdempotencyKey('cancel'),
      })
    ).data;
  }

  async tocVersion(planId: string, tocVersionId: string): Promise<TocVersion> {
    return (await this.client.call<TocVersion>(`/plans/${planId}/toc-versions/${tocVersionId}`))
      .data;
  }

  /**
   * UNE-PLAN-014. **트리를 다시 실어야 한다** — 확정은 "이 트리를 확정한다"이지
   * "그 버전을 확정한다"가 아니다. 그래서 사용자가 화면에서 고친 목차가 그대로
   * 저장된다. 지금 화면은 목차를 고치지 않으므로 생성된 트리를 그대로 되싣는다.
   */
  async confirmToc(planId: string, tocVersionId: string): Promise<TocVersion> {
    const version = await this.tocVersion(planId, tocVersionId);
    return (
      await this.client.call<TocVersion>(`/plans/${planId}/toc-versions`, {
        method: 'POST',
        body: {
          baseVersionId: tocVersionId,
          tocTree: toTocTree(version.nodes ?? []),
          confirm: true,
        },
        idempotencyKey: newIdempotencyKey('toc-confirm'),
      })
    ).data;
  }

  // ── Export (UNE-DOC-012/013/014) ───────────────────────────────────────
  async requestExport(documentId: string): Promise<ExportJob> {
    return (
      await this.client.call<ExportJob>(`/documents/${documentId}/exports`, {
        method: 'POST',
        body: { format: 'HWPX' },
        idempotencyKey: newIdempotencyKey('export'),
      })
    ).data;
  }

  async exportStatus(exportId: string): Promise<ExportJob> {
    return (await this.client.call<ExportJob>(`/exports/${exportId}`)).data;
  }

  download(exportId: string): Promise<{ blob: Blob; fileName: string; sha256: string }> {
    return this.client.downloadExport(exportId);
  }
}

/** 목차 노드를 저장 요청(`TocTreeNodeInput`) 형태로 되돌린다. */
function toTocTree(nodes: NonNullable<TocVersion['nodes']>): unknown[] {
  return nodes.map((node) => ({
    nodeKey: node.nodeKey,
    title: node.title,
    ...(node.children && node.children.length > 0
      ? { children: toTocTree(node.children as NonNullable<TocVersion['nodes']>) }
      : {}),
  }));
}
