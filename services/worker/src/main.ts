import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  createObjectStorage,
  createT3qPlanProvider,
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
  runners.push(new ExportJobRunner(db, createObjectStorage(process.env), config));

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

  const shutdown = async (): Promise<void> => {
    clearInterval(timer);
    if (retentionTimer) clearInterval(retentionTimer);
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
