import type { Provider } from '@nestjs/common';
import { createLogger, type LogLevel, type StructuredLogger } from './logger';
import { MetricsRegistry, METRICS } from './metrics';

/**
 * 로거·메트릭 주입 토큰 (CC-430).
 *
 * `SITUATION_PROVIDERS`·`OBJECT_STORAGE`와 같은 형태다 — 토큰 하나, 팩토리
 * 하나, 설정은 여기서 한 번만 읽는다. 서비스가 전역 싱글턴을 직접 부르면
 * 테스트가 줄을 가로챌 방법이 없다.
 */

export { type StructuredLogger } from './logger';

export const LOGGER = Symbol('LOGGER');

const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

export function resolveLogLevel(raw: string | undefined): LogLevel {
  const value = (raw ?? 'info').trim().toLowerCase();
  return (LEVELS as readonly string[]).includes(value) ? (value as LogLevel) : 'info';
}

export const loggerProvider: Provider = {
  provide: LOGGER,
  useFactory: (): StructuredLogger =>
    createLogger({ service: 'une-api', level: resolveLogLevel(process.env.UNE_LOG_LEVEL) }),
};

export const metricsProvider: Provider = {
  provide: METRICS,
  useFactory: (): MetricsRegistry => new MetricsRegistry(),
};

export { METRICS, MetricsRegistry } from './metrics';
