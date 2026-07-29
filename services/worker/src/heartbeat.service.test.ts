import { describe, expect, it } from 'vitest';
import { HeartbeatService } from './heartbeat.service';

describe('HeartbeatService', () => {
  it('counts ticks monotonically', () => {
    const service = new HeartbeatService();
    expect(service.tick()).toBe(1);
    expect(service.tick()).toBe(2);
  });
});
