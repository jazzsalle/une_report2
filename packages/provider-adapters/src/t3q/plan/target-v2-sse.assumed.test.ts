import { describe, expect, it } from 'vitest';
import {
  TargetV2SseError,
  isTerminalTargetV2Event,
  parseTargetV2Sse,
  serializeTargetV2Sse,
  type TargetV2SseFrame,
} from './target-v2-sse.assumed';

const frames: TargetV2SseFrame[] = [
  { id: 1, event: 'job.started', data: { sequence: 1, status: 'RUNNING', progress: 0 } },
  { id: 2, event: 'content.block', data: { sequence: 2, block: { blockId: 'blk-1' } } },
  { id: 3, event: 'job.completed', data: { sequence: 3, status: 'COMPLETED' } },
];

describe('target-v2 SSE (.assumed framing, OB-10)', () => {
  it('round-trips serialize → parse without loss or duplication (AT-T3Q-005)', () => {
    const transcript = serializeTargetV2Sse(frames);
    expect(transcript).toContain(': heartbeat'); // comment keepalive is emitted
    const parsed = parseTargetV2Sse(transcript);
    expect(parsed).toEqual(frames);
  });

  it('skips heartbeat/comment records instead of failing on them', () => {
    const transcript = `: heartbeat\n\n${serializeTargetV2Sse(frames)}\n: heartbeat\n`;
    expect(parseTargetV2Sse(transcript)).toEqual(frames);
  });

  it('rejects a sequence that disagrees with the SSE id', () => {
    const bad = 'id: 1\nevent: job.started\ndata: {"sequence":9}\n';
    expect(() => parseTargetV2Sse(bad)).toThrowError(TargetV2SseError);
  });

  it('rejects non-increasing ids (duplicate replay would double-apply)', () => {
    const bad =
      'id: 2\nevent: content.block\ndata: {"sequence":2}\n\n' +
      'id: 2\nevent: content.block\ndata: {"sequence":2}\n';
    expect(() => parseTargetV2Sse(bad)).toThrowError(/strictly increasing/);
  });

  it('rejects non-JSON data as malformed framing', () => {
    const bad = 'id: 1\nevent: job.started\ndata: not-json\n';
    expect(() => parseTargetV2Sse(bad)).toThrowError(/not valid JSON/);
  });

  it('names exactly job.completed/job.failed as terminal', () => {
    expect(isTerminalTargetV2Event('job.completed')).toBe(true);
    expect(isTerminalTargetV2Event('job.failed')).toBe(true);
    expect(isTerminalTargetV2Event('content.block')).toBe(false);
    expect(isTerminalTargetV2Event('heartbeat')).toBe(false);
  });
});
