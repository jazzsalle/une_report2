import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LegacySseError, parseLegacySseTranscript } from './legacy-sse';

const FIXTURE = resolve(
  process.cwd(),
  '..',
  '..',
  'tests',
  'contract',
  'fixtures',
  't3q-legacy',
  'rpt-002.stream.assumed.sse.txt',
);

describe('parseLegacySseTranscript (framing is a UNE assumption — OB-01)', () => {
  it('parses the CC-115 assumed transcript fixture', () => {
    const payloads = parseLegacySseTranscript(readFileSync(FIXTURE, 'utf8'));
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toMatchObject({ name: '1. 추진 배경' });
    expect(payloads[1]).toMatchObject({ name: '1. 무더위쉼터 운영' });
  });

  it('rejects a stream cut before [DONE] (no partial results)', () => {
    expect(() => parseLegacySseTranscript('data: {"name":"a","content":"b"}\n\n')).toThrow(
      LegacySseError,
    );
    expect(() => parseLegacySseTranscript('data: {"name":"a","content":"b"}\n\n')).toThrow(/DONE/);
    // A frame cut mid-JSON fails at the frame level, also loudly.
    expect(() => parseLegacySseTranscript('data: {"name":"a"')).toThrow(/not valid JSON/);
  });

  it('rejects non-JSON data frames', () => {
    expect(() => parseLegacySseTranscript('data: not-json\n\ndata: [DONE]\n\n')).toThrow(
      /not valid JSON/,
    );
  });

  it('rejects frames after the [DONE] sentinel', () => {
    expect(() => parseLegacySseTranscript('data: [DONE]\n\ndata: {"name":"late"}\n\n')).toThrow(
      /after \[DONE\]/,
    );
  });

  it('ignores comment/keepalive lines and handles CRLF', () => {
    const body = ': keepalive\r\n\r\ndata: {"x":1}\r\n\r\ndata: [DONE]\r\n\r\n';
    expect(parseLegacySseTranscript(body)).toEqual([{ x: 1 }]);
  });

  it('rejects unexpected field lines (event:, id:) — framing must fail loudly', () => {
    expect(() =>
      parseLegacySseTranscript('event: section\ndata: {"x":1}\n\ndata: [DONE]\n\n'),
    ).toThrow(/unexpected SSE line/);
  });
});
