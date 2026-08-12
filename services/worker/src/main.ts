import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  createObjectStorage,
  createT3qPlanProvider,
  createUniKnowledgeProvider,
  describeRuntimeCapability,
  describeRuntimeFeature,
  type ContentCapable,
  type PlanProviderFactoryOptions,
  type T3qPlanProvider,
} from '@une/provider-adapters';
import { WorkerModule } from './worker.module';
import { HeartbeatService } from './heartbeat.service';
import { loadWorkerConfig, type WorkerConfig } from './config/worker-config';
import { WorkerDatabase } from './db/worker-database.service';
import { PlanJobPoller, type PlanJobRunner } from './plan-jobs/job.poller';
import { TocJobRunner } from './plan-toc/toc-job.runner';
import { ContentJobRunner } from './plan-content/content-job.runner';
import { ExportJobRunner } from './document-export/export-job.runner';
import { PayloadRetentionRunner } from './retention/payload-retention.runner';
import { KnowledgeUploadRunner } from './knowledge/knowledge-upload.runner';
import { createSopWiring } from './sop/sop-wiring';

function factoryOptions(config: WorkerConfig): PlanProviderFactoryOptions {
  switch (config.planAdapter) {
    case 'legacy-http':
      return {
        kind: 'legacy-http',
        legacyHttp: config.t3qHttp as NonNullable<WorkerConfig['t3qHttp']>,
      };
    case 'mock-target-v2':
      return { kind: 'mock-target-v2' };
    default:
      return { kind: 'mock-legacy', mock: { scenariosEnabled: config.mockScenariosEnabled } };
  }
}

function isContentCapable(adapter: T3qPlanProvider): adapter is T3qPlanProvider & ContentCapable {
  return adapter.supports('content');
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const heartbeat = app.get(HeartbeatService);
  const config = loadWorkerConfig();
  const db = new WorkerDatabase(config);
  const adapter = createT3qPlanProvider(factoryOptions(config));
  const runners: PlanJobRunner[] = [new TocJobRunner(db, adapter, config)];
  // CONTENT jobs run only when the selected adapter supports the operation
  // — jobs stay QUEUED otherwise (CC-135: mock-target-v2 is content-capable;
  // the operating profile remains legacy).
  if (isContentCapable(adapter)) {
    runners.push(new ContentJobRunner(db, adapter, config));
  } else {
    console.warn(
      `[une-worker] adapter ${adapter.adapterId} does not support 'content' — ` +
        `CONTENT jobs will remain QUEUED until a content-capable adapter is selected`,
    );
  }
  // CC-160: HWPX 보존 Export. 저장소 설정이 없으면 **기동에서** 실패한다 —
  // 러너 없이 뜨면 Export가 영원히 QUEUED로 남고 이유가 어디에도 남지 않는다.
  // 오브젝트 저장소는 내보내기와 지식문서 전송이 함께 쓴다 — 인스턴스를 하나만
  // 만든다(둘로 만들면 커넥션 풀과 자격증명이 두 벌이 된다).
  const storage = createObjectStorage(process.env);
  runners.push(new ExportJobRunner(db, storage, config));

  // CC-240: UNI SOP 생성. 플랜 잡 폴러에 **얹는다** — 지식문서 파이프라인과
  // 달리 이것은 `generation_job` 위에서 도는 잡이고, TOC/CONTENT와 같은 클레임
  // ·리스·취소 규약을 그대로 쓴다. 지식문서 쪽을 따로 뺐던 이유(그쪽은
  // knowledge_document 자체 스윕이다)가 여기엔 해당하지 않는다.
  // 조립은 `sop/sop-wiring.ts`가 한다 — 이 파일은 플랜 잡도 함께 조립하므로
  // AT-T3Q-011 가드의 예외로 둘 수 없다(그 규칙이 가장 필요한 자리다).
  const sopWiring = createSopWiring(db, config, process.env);
  if (config.sopEnabled) {
    runners.push(sopWiring.runner);
  } else {
    console.warn(
      '[une-worker] SOP 생성 러너 DISABLED (UNE_SOP_ENABLED=false) — SOP 잡이 QUEUED로 남는다',
    );
  }

  const poller = new PlanJobPoller(runners, config);
  poller.start();

  const timer = setInterval(() => heartbeat.tick(), 30_000);

  // 보존기간 정리 (OB-16). 플랜 잡 폴러에 얹지 않는다 — 폴러의 주기는 초
  // 단위이고 이 작업의 만료 단위는 '일'이다. 별도 타이머로 두면 "언제 돌았고
  // 몇 건을 비웠는가"가 폴링 로그에 묻히지 않는다.
  const retention = new PayloadRetentionRunner(db, config);
  const runRetention = async (): Promise<void> => {
    try {
      const swept = await retention.sweep();
      // 0건이어도 남긴다. 건수로만 로그를 내면 "비울 게 없었다"와 "한 번도
      // 돌지 못했다"가 로그상 같아지는데, 후자는 원문이 무기한 남는 상태다
      // (배포 전 롤 멤버십 항목 — OB-17).
      console.warn(
        `[une-worker] retention swept: provider_result ${swept.providerResults}건, ` +
          `provider_job ${swept.providerJobs}건 (기준 ${config.payloadRetentionDays}일, ` +
          `cutoff ${swept.cutoff}) / 잔여 만료분 result ${swept.remainingResults}건, ` +
          `job ${swept.remainingJobs}건`,
      );
    } catch (err) {
      // 정리 실패가 워커를 죽이지 않는다 — 다음 주기에 다시 시도한다.
      console.error(`[une-worker] retention sweep failed: ${(err as Error).message}`);
    }
  };
  let retentionTimer: NodeJS.Timeout | undefined;
  if (config.retentionEnabled) {
    retentionTimer = setInterval(() => void runRetention(), config.retentionIntervalMs);
    void runRetention();
  } else {
    console.warn(
      '[une-worker] retention DISABLED (UNE_RETENTION_ENABLED=false) — provider 원문이 ' +
        '무기한 남는다. OB-16이 다시 열린 상태다.',
    );
  }

  // 지식문서 UNI 전송 (CC-220). 플랜 잡 폴러에 얹지 않는다 — 그쪽은
  // T3qPlanProvider 전용이고, UNI를 그 경로에 넣으면 "플랜 흐름에 UNI 폴백
  // 없음"(CLAUDE.md, AT-T3Q-011)이 코드 구조에서 흐려진다.
  const uni = createUniKnowledgeProvider(process.env);
  const knowledge = new KnowledgeUploadRunner(db, storage, uni, config);
  const runKnowledgeUpload = async (): Promise<void> => {
    try {
      // 큐가 비어 있을 때까지 계속 집는다. 한 주기에 하나만 집으면 밀린 문서가
      // 주기 × 개수만큼 늦어진다.
      for (;;) {
        const r = await knowledge.runOnce();
        if (r.claimed === 0) break;
        console.warn(`[une-worker] knowledge upload: 등록 ${r.registered}건, 실패 ${r.failed}건`);
      }
    } catch (err) {
      console.error(`[une-worker] knowledge upload failed: ${(err as Error).message}`);
    }
  };
  const runKnowledgePoll = async (): Promise<void> => {
    try {
      const r = await knowledge.pollOnce();
      if (r.polled > 0) {
        console.warn(`[une-worker] knowledge poll: ${r.polled}건 관측, ${r.advanced}건 변화`);
      }
      // 참조요약은 READY 이후에만 생기므로 상태 스윕과 같은 주기로 돌되
      // 대상 집합은 따로 고른다(US-SIT-010 4단계).
      const ref = await knowledge.pollReferences();
      if (ref.polled > 0) {
        console.warn(`[une-worker] reference poll: ${ref.polled}건 조회, ${ref.stored}건 저장`);
      }
    } catch (err) {
      console.error(`[une-worker] knowledge poll failed: ${(err as Error).message}`);
    }
  };
  let knowledgeUploadTimer: NodeJS.Timeout | undefined;
  let knowledgePollTimer: NodeJS.Timeout | undefined;
  if (config.knowledgeEnabled) {
    console.warn(
      `[une-worker] knowledge UNI adapter: ${uni.adapterId}` +
        (uni.isMock ? ' (MOCK — UNI 지원이 아니다)' : ' (실 HTTP — provider 미검증, OB-13)'),
    );
    knowledgeUploadTimer = setInterval(
      () => void runKnowledgeUpload(),
      config.knowledgeUploadIntervalMs,
    );
    knowledgePollTimer = setInterval(() => void runKnowledgePoll(), config.knowledgePollIntervalMs);
  } else {
    console.warn('[une-worker] knowledge UNI pipeline DISABLED (UNE_KNOWLEDGE_ENABLED=false)');
  }

  const shutdown = async (): Promise<void> => {
    clearInterval(timer);
    if (retentionTimer) clearInterval(retentionTimer);
    if (knowledgeUploadTimer) clearInterval(knowledgeUploadTimer);
    if (knowledgePollTimer) clearInterval(knowledgePollTimer);
    await poller.stop(); // drain the in-flight tick before closing the pool
    await db.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  heartbeat.tick();
  console.log(
    `une-worker started (plan-job polling every ${config.pollIntervalMs}ms as role ${config.runtimeRole || '(connection role)'}; adapter=${adapter.adapterId}; runners=${runners.length}; outbox relay arrives with CC-270)`,
  );
  // AT-T3Q-012: the capability line folds the INSTANCE runtime mode into
  // the governed state (review M3) — a mock instance always prints MOCK
  // RUNTIME, never a bare UNE_ADAPTER_READY.
  console.warn(`[une-worker] capability ${describeRuntimeCapability(adapter, 'toc')}`);
  console.warn(`[une-worker] capability ${sopWiring.capabilityLine}`);
  console.warn(`[une-worker] capability ${describeRuntimeCapability(adapter, 'content')}`);
  if (adapter.variant === 'target-v2') {
    // CC-135 AC "mock-only status visible": every finer-grained v2 feature
    // prints its governed state + MOCK RUNTIME marker at startup.
    for (const featureId of [
      'semanticEdit',
      'evidenceSearch',
      'validation',
      'jobStatus',
      'jobSse',
      'jobCancel',
      'partialRetry',
      'capabilityDiscovery',
    ]) {
      console.warn(`[une-worker] capability ${describeRuntimeFeature(adapter, featureId)}`);
    }
  }
  if (adapter.runtimeMode === 'live') {
    console.warn(
      `[une-worker] T3Q provider = ${adapter.adapterId} (live transport — provider 미검증, ` +
        `OB-01 OPEN; T3Q 검증 전까지 성공을 T3Q 지원으로 보고하지 말 것)`,
    );
  }
}

void bootstrap();
