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
export type DocumentIrResource = Schemas['DocumentIrResource'];
export type ChangeSetResult = Schemas['ChangeSetResult'];

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

  // ── 문서 편집 (UNE-DOC-005/006) ────────────────────────────────────────
  async documentIr(documentId: string): Promise<{ ir: DocumentIrResource; etag: string | null }> {
    const result = await this.client.call<DocumentIrResource>(`/documents/${documentId}/ir`);
    return { ir: result.data, etag: result.etag };
  }

  /**
   * UNE-DOC-006 materialize — 생성된 블록을 문서에 실제로 넣는다.
   *
   * 이것이 없으면 화면으로 내려받은 HWPX에는 **생성 본문이 한 글자도 없다**
   * (업로드한 원본 그대로다). 편집기가 없는 지금(OB-12) 문서를 실제로 바꾸는
   * 유일한 경로이므로 화면에도 있어야 한다.
   *
   * `If-Match`와 `baseRevisionId`가 둘 다 필요한 이중 가드다.
   */
  async materialize(input: {
    documentId: string;
    planId: string;
    tocVersionId: string;
    /** 분석 결과의 정적영역 로케이터. 그 안의 문단 뒤에는 놓을 수 없다. */
    staticAnchors: readonly string[];
  }): Promise<ChangeSetResult> {
    const { ir, etag } = await this.documentIr(input.documentId);
    const anchorParagraphId = pickAnchorParagraph(ir, input.staticAnchors);
    if (!anchorParagraphId) {
      throw new Error(
        '삽입할 자리를 찾지 못했습니다 — 정적영역 밖의 편집 가능한 문단이 필요합니다.',
      );
    }
    return (
      await this.client.call<ChangeSetResult>(`/documents/${input.documentId}/changesets`, {
        method: 'POST',
        ifMatch: etag ?? undefined,
        body: {
          baseRevisionId: ir.revisionId,
          origin: 'MATERIALIZE',
          clientMutationId: newIdempotencyKey('materialize'),
          checkpointLabel: '초안완료',
          operations: [
            {
              type: 'INSERT_BLOCKS',
              order: 0,
              anchor: { relation: 'AFTER', ref: anchorParagraphId },
              source: {
                kind: 'GENERATED_BLOCKS',
                planId: input.planId,
                tocVersionId: input.tocVersionId,
              },
            },
          ],
        },
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

interface IrBlock {
  kind: string;
  paragraphId?: string;
  rawXmlAnchor?: string;
  editState?: { locked?: boolean };
  runs?: { text: string }[];
}

/**
 * 실체화한 블록을 놓을 자리를 고른다.
 *
 * 두 제약이 있고 둘 다 **의도된 거절**이다: 정적영역(결재란·머리글) 문단 뒤에는
 * 놓을 수 없고(고정 서식을 생성물이 밀어내면 양식이 깨진다), 섹션의 마지막
 * 자식이 표면 그 뒤에 문단을 놓는 되쓰기가 아직 열려 있지 않다. 그래서
 * **정적영역 밖의 마지막 문단 뒤**를 고른다(ADR-32 수용 한계 1).
 */
export function pickAnchorParagraph(
  ir: DocumentIrResource,
  staticAnchors: readonly string[],
): string | null {
  const blocked = new Set(staticAnchors);
  const sections = (ir.ir as { sections?: { blocks?: IrBlock[] }[] } | undefined)?.sections ?? [];
  let chosen: string | null = null;
  for (const block of sections[0]?.blocks ?? []) {
    if (block.kind !== 'PARAGRAPH') continue;
    if (block.editState?.locked) continue;
    if (block.rawXmlAnchor && blocked.has(block.rawXmlAnchor)) continue;
    if (
      (block.runs ?? [])
        .map((run) => run.text)
        .join('')
        .trim().length === 0
    )
      continue;
    chosen = block.paragraphId ?? chosen;
  }
  return chosen;
}
