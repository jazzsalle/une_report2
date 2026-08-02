import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  createT3qPlanProvider,
  describeRuntimeCapability,
  type PlanProviderFactoryOptions,
} from '@une/provider-adapters';
import { WorkerModule } from './worker.module';
import { HeartbeatService } from './heartbeat.service';
import { loadWorkerConfig, type WorkerConfig } from './config/worker-config';
import { WorkerDatabase } from './db/worker-database.service';
import { TocJobPoller } from './plan-toc/toc-job.poller';
import { TocJobRunner } from './plan-toc/toc-job.runner';

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

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const heartbeat = app.get(HeartbeatService);
  const config = loadWorkerConfig();
  const db = new WorkerDatabase(config);
  const adapter = createT3qPlanProvider(factoryOptions(config));
  const runner = new TocJobRunner(db, adapter, config);
  const poller = new TocJobPoller(runner, config);
  poller.start();

  const timer = setInterval(() => heartbeat.tick(), 30_000);
  const shutdown = async (): Promise<void> => {
    clearInterval(timer);
    await poller.stop(); // drain the in-flight tick before closing the pool
    await db.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  heartbeat.tick();
  console.log(
    `une-worker started (TOC job polling every ${config.pollIntervalMs}ms as role ${config.runtimeRole || '(connection role)'}; adapter=${adapter.adapterId}; outbox relay arrives with CC-270)`,
  );
  // AT-T3Q-012: the capability line folds the INSTANCE runtime mode into
  // the governed state (review M3) — a mock instance always prints MOCK
  // RUNTIME, never a bare UNE_ADAPTER_READY.
  console.warn(`[une-worker] capability ${describeRuntimeCapability(adapter, 'toc')}`);
  if (adapter.runtimeMode === 'live') {
    console.warn(
      `[une-worker] T3Q provider = ${adapter.adapterId} (live transport — provider 미검증, ` +
        `OB-01 OPEN; T3Q 검증 전까지 성공을 T3Q 지원으로 보고하지 말 것)`,
    );
  }
}

void bootstrap();
