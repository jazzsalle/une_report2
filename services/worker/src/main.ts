import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { MockLegacyT3qTocAdapter } from '@une/provider-adapters';
import { WorkerModule } from './worker.module';
import { HeartbeatService } from './heartbeat.service';
import { loadWorkerConfig } from './config/worker-config';
import { WorkerDatabase } from './db/worker-database.service';
import { TocJobPoller } from './plan-toc/toc-job.poller';
import { TocJobRunner } from './plan-toc/toc-job.runner';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const heartbeat = app.get(HeartbeatService);
  const config = loadWorkerConfig();
  const db = new WorkerDatabase(config);
  // CC-120: TOC jobs run against the deterministic mock adapter (capability
  // legacyToc = MOCK_ONLY). CC-125 swaps in the real LegacyT3qPlanAdapter
  // behind the same port — never report this mock as actual T3Q support.
  const runner = new TocJobRunner(
    db,
    new MockLegacyT3qTocAdapter({ scenariosEnabled: config.mockScenariosEnabled }),
    config,
  );
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
    `une-worker started (TOC job polling every ${config.pollIntervalMs}ms as role ${config.runtimeRole || '(connection role)'}; outbox relay arrives with CC-270)`,
  );
  // AT-T3Q-012: mock support must be visibly distinguished in logs.
  console.warn(
    `[une-worker] T3Q provider = mock-legacy-v0.8.5 (MOCK_ONLY — 실제 T3Q 지원 아님; ` +
      `실 어댑터는 CC-125, capability legacyToc 참조)`,
  );
}

void bootstrap();
