import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { HeartbeatService } from './heartbeat.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const heartbeat = app.get(HeartbeatService);
  // Outbox/job polling loops arrive with CC-270; the skeleton only proves the
  // standalone application context starts and stays alive.
  const timer = setInterval(() => heartbeat.tick(), 30_000);
  const shutdown = async (): Promise<void> => {
    clearInterval(timer);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  heartbeat.tick();
  console.log('une-worker started (skeleton; no outbox polling until CC-270)');
}

void bootstrap();
