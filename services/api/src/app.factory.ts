import 'reflect-metadata';
import { RequestMethod, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { requestContextMiddleware } from './common/request-context';
import { loadApiConfig, type ApiConfig } from './config/api-config';

export async function createApp(config: ApiConfig = loadApiConfig()): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.register(config), {
    logger: ['error', 'warn'],
  });
  app.use(requestContextMiddleware);
  // Contract base path (une-platform-api-v1.yaml). /health stays at the root
  // as an out-of-contract operational endpoint.
  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });
  return app;
}
