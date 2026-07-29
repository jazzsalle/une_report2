import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // Contract base path (une-platform-api-v1.yaml). /health stays at the root
  // as an out-of-contract operational endpoint.
  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`une-api listening on :${port} (AUTH_MODE=${process.env.AUTH_MODE ?? 'unset'})`);
}

void bootstrap();
