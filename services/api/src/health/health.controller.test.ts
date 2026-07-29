import { describe, expect, it } from 'vitest';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports ok with service name and ISO timestamp', () => {
    const report = new HealthController().health();
    expect(report.status).toBe('ok');
    expect(report.service).toBe('une-api');
    expect(() => new Date(report.timestamp).toISOString()).not.toThrow();
  });
});
