import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { isPollExhausted, uniPollDelayMs } from '@une/domain';
import type { ObjectStoragePort, UniKnowledgeProvider } from '@une/provider-adapters';
import type { WorkerConfig } from '../config/worker-config';
import type { WorkerDatabase } from '../db/worker-database.service';
import {
  claimUploadJob,
  insertProviderResult,
  loadUploadTarget,
  markUploading,
  recordReference,
  recordUniStatus,
  selectPollTargets,
  selectReferenceTargets,
  settleFailed,
  settleJobFailed,
  settleRegistered,
} from './knowledge-upload.repository';

/**
 * 지식문서 UNI 전송 러너 (CC-220).
 *
 * 설계 10 §7.23 정상 Sequence 7단계가 UNI 호출자를 **워커**로 정했다. API는
 * 잡을 커밋하고 202로 끝나며(동기 상황 수집과 갈리는 지점) 실제 전송은 여기서
 * 일어난다.
 *
 * **외부 호출은 트랜잭션 밖이다**(`.claude/rules/backend.md`). 그래서 한 잡이
 * 세 구간으로 나뉜다.
 *
 *   1) 디스패치 스코프 트랜잭션 — QUEUED 하나를 RUNNING으로 집는다.
 *   2) 테넌트 스코프 트랜잭션 — 문서·파일 메타를 읽고 UPLOADING으로 옮긴다.
 *      (`file_object`·`knowledge_document`의 테넌트 정책이 TO PUBLIC이라
 *       디스패치 스코프에서는 0행이다.)
 *   3) 트랜잭션 **밖** — 저장소에서 파일을 받아 UNI에 보낸다.
 *   4) 테넌트 스코프 트랜잭션 — 원문을 남기고 문서·잡을 종결한다.
 *
 * 3에서 죽으면 잡은 RUNNING으로 남는다. 그것을 자동으로 되돌리지 않는다 —
 * UNI 업로드에는 멱등키가 없어(OB-13) 우리가 못 받은 응답을 저쪽이 이미
 * 처리했을 수 있고, 자동 재큐잉은 같은 문서를 두 벌 만든다. 사람이
 * UNE-KNOW-003으로 판단한다.
 */

export interface UploadSweepResult {
  claimed: number;
  registered: number;
  failed: number;
}

export interface PollSweepResult {
  polled: number;
  advanced: number;
}

export interface ReferenceSweepResult {
  polled: number;
  stored: number;
}

export class KnowledgeUploadRunner {
  constructor(
    private readonly db: WorkerDatabase,
    private readonly storage: ObjectStoragePort,
    private readonly uni: UniKnowledgeProvider,
    private readonly config: WorkerConfig,
  ) {}

  /** 한 번에 잡 하나. 배치로 집지 않는다 — 업로드는 느리고 되돌릴 수 없다. */
  async runOnce(): Promise<UploadSweepResult> {
    const claimed = await this.db.withDispatchScope((c: PoolClient) => claimUploadJob(c));
    if (!claimed) return { claimed: 0, registered: 0, failed: 0 };

    if (!claimed.knowledgeDocumentId) {
      // 요청 모양이 틀렸다. 문서를 가리키지 못하므로 잡만 닫는다 — 열어 두면
      // RUNNING에 갇힌다.
      await this.db.withDispatchScope((c: PoolClient) =>
        settleJobFailed(c, claimed.providerJobId, {
          code: 'KNOWLEDGE_JOB_MALFORMED',
          message: 'request_json에 knowledgeDocumentId가 없다',
        }),
      );
      return { claimed: 1, registered: 0, failed: 1 };
    }

    const target = await this.db.withTenant(claimed.tenantId, async (c) => {
      const t = await loadUploadTarget(c, claimed.tenantId, claimed.knowledgeDocumentId);
      if (t) await markUploading(c, claimed.tenantId, claimed.knowledgeDocumentId);
      return t;
    });

    if (!target) {
      // 잡이 가리키는 문서가 없다. 조용히 두면 RUNNING으로 영원히 남는다.
      await this.db.withTenant(claimed.tenantId, (c) =>
        settleFailed(c, claimed.tenantId, claimed.knowledgeDocumentId, claimed.providerJobId, {
          // UNI의 문제가 아니다. 포트 오류코드를 쓰면 감사 기록을 읽는 사람이
          // UNI 장애로 오진한다(QA 검토 R9).
          code: 'KNOWLEDGE_DOCUMENT_MISSING',
          message: '잡이 가리키는 지식문서를 찾을 수 없다',
          retryable: false,
          sideEffectUncertain: false,
        }),
      );
      return { claimed: 1, registered: 0, failed: 1 };
    }

    // ── 트랜잭션 밖: 저장소 읽기 + UNI 호출 ──
    let content: Uint8Array;
    try {
      const fetched = await this.storage.get(target.storageKey);
      content = fetched.body;
    } catch {
      await this.db.withTenant(claimed.tenantId, (c) =>
        settleFailed(c, claimed.tenantId, target.knowledgeDocumentId, claimed.providerJobId, {
          code: 'STORAGE_READ_FAILED',
          // 저장소 오류 문구는 엔드포인트·버킷·키를 담을 수 있고 이 값은
          // UNE-KNOW-002가 그대로 돌려준다(QA 검토 R8). 분류만 남긴다.
          message: '원본 파일을 읽을 수 없습니다.',
          retryable: true,
          sideEffectUncertain: false,
        }),
      );
      return { claimed: 1, registered: 0, failed: 1 };
    }

    const result = await this.uni.uploadDocument(
      {
        fileName: target.originalName,
        mimeType: target.mimeType,
        content,
        uploader: target.createdBy,
        force: claimed.force,
      },
      { correlationId: claimed.correlationId },
    );

    // ── 다시 테넌트 스코프: 원문 먼저, 그다음 종결 ──
    return this.db.withTenant(claimed.tenantId, async (c) => {
      const rawPayload = { request: result.raw.requestSummary, response: result.raw.responseBody };
      await insertProviderResult(
        c,
        claimed.providerJobId,
        rawPayload,
        sha256Of(rawPayload),
        result.ok ? 1 : 0,
      );

      if (result.ok) {
        await settleRegistered(
          c,
          claimed.tenantId,
          target.knowledgeDocumentId,
          claimed.providerJobId,
          result.value.documentId,
        );
        return { claimed: 1, registered: 1, failed: 0 };
      }

      await settleFailed(
        c,
        claimed.tenantId,
        target.knowledgeDocumentId,
        claimed.providerJobId,
        result.error,
      );
      return { claimed: 1, registered: 0, failed: 1 };
    });
  }

  /**
   * UNI 처리상태를 한 바퀴 관측한다 (US-SIT-010).
   *
   * 설계 08 §1.14의 2/4/8/15초 backoff는 **한 문서를 붙잡고 기다리는** 폴링의
   * 간격이다. 여기서는 그렇게 하지 않는다 — 워커가 한 문서에 5분을 매달리면
   * 그동안 다른 문서가 멈춘다. 대신 문서마다 `uni_observed_at`을 남기고 스윕이
   * 주기적으로 돌면서 오래 안 본 것부터 확인한다. 결과는 같고 한 문서가 전체를
   * 막지 않는다.
   */
  async pollOnce(): Promise<PollSweepResult> {
    const targets = await this.db.withDispatchScope((c: PoolClient) =>
      selectPollTargets(c, this.config.knowledgePollBatchSize),
    );
    let advanced = 0;
    for (const t of targets) {
      const res = await this.uni.getDocumentStatus(t.providerDocumentId, {
        correlationId: `poll-${t.knowledgeDocumentId}`,
      });
      if (!res.ok) continue;
      await this.db.withTenant(t.tenantId, (c) =>
        recordUniStatus(c, t.tenantId, t.knowledgeDocumentId, res.value.status),
      );
      if (res.value.status !== t.uniStatus) advanced += 1;
    }
    return { polled: targets.length, advanced };
  }

  /**
   * 참조요약을 한 바퀴 받아 온다 (US-SIT-010 4단계).
   *
   * 상태 폴링과 분리한 이유: 참조요약은 `READY` 이후에만 생기고 한 번 받으면
   * 끝이다. 상태 스윕에 얹으면 이미 READY인 문서를 상태 때문에 계속 훑거나
   * 참조요약 때문에 상태를 다시 묻게 된다 — 두 축의 종료 조건이 다르다.
   */
  async pollReferences(): Promise<ReferenceSweepResult> {
    const targets = await this.db.withDispatchScope((c: PoolClient) =>
      selectReferenceTargets(c, this.config.knowledgePollBatchSize),
    );
    let stored = 0;
    for (const t of targets) {
      const res = await this.uni.getReference(t.providerDocumentId, {
        correlationId: `ref-${t.knowledgeDocumentId}`,
      });
      // 실패도, 아직 준비되지 않은 것(202)도 쓰지 않는다 — 다음 스윕이 다시 묻는다.
      if (!res.ok || !res.value.ready || res.value.reference === null) continue;
      await this.db.withTenant(t.tenantId, (c) =>
        recordReference(c, t.tenantId, t.knowledgeDocumentId, res.value.reference),
      );
      stored += 1;
    }
    return { polled: targets.length, stored };
  }
}

function sha256Of(payload: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(payload ?? null))
    .digest('hex');
}

/** 설계 08 §1.14의 간격을 그대로 노출한다 — 폴링 주기를 정하는 쪽이 쓴다. */
export { uniPollDelayMs, isPollExhausted };
