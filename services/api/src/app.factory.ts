import 'reflect-metadata';
import { RequestMethod, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, raw } from 'express';
import { AppModule } from './app.module';
import { requestContextMiddleware } from './common/request-context';
import { loadApiConfig, type ApiConfig } from './config/api-config';

export async function createApp(config: ApiConfig = loadApiConfig()): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.register(config), {
    logger: ['error', 'warn'],
  });
  app.use(requestContextMiddleware);
  // 업로드 전송 라우트만 원시 바이트로 받는다(CC-170). 전역으로 켜면 JSON
  // 경로의 파서와 충돌하므로 경로를 좁혀 적용한다. 상한은 설정값이며, 여기서
  // 넘긴 요청은 express가 413으로 끝낸다 — 티켓의 크기 검사와 이중이다.
  app.use('/api/v1/files/:fileId/content', raw({ type: '*/*', limit: config.uploadMaxBytes }));
  // **JSON 본문 상한을 명시한다.** 전에는 express 기본값(100kb)이 조용히
  // 걸렸고, 그 오류가 HttpException이 아니라 500 COM-0001로 나갔다(실측).
  // 여기서 값을 정하고 필터가 413으로 옮긴다.
  app.use(json({ limit: config.jsonMaxBytes }));
  if (config.corsAllowedOrigins.length > 0) {
    // 토큰은 Authorization 헤더로 다니므로 credentials를 켜지 않는다.
    // 허용 출처는 설정에 적힌 목록뿐이다(와일드카드는 loadApiConfig가 거부).
    app.enableCors({
      origin: [...config.corsAllowedOrigins],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: [
        'Authorization',
        'Content-Type',
        'If-Match',
        'Idempotency-Key',
        'X-Correlation-Id',
        'Last-Event-ID',
      ],
      exposedHeaders: ['ETag', 'X-Correlation-Id', 'X-Content-Sha256', 'Content-Disposition'],
      credentials: false,
      maxAge: 600,
    });
  }
  // Contract base path (une-platform-api-v1.yaml). /health stays at the root
  // as an out-of-contract operational endpoint.
  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });
  return app;
}
