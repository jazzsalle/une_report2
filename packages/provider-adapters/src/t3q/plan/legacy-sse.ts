/**
 * RPT-002 text/event-stream frame parser (CC-125).
 *
 * FRAMING IS A UNE ASSUMPTION (OB-01): the pinned transcript only fixes
 * `x-sse-done: '[DONE]'`; the frame structure follows the CC-115 fixture
 * `rpt-002.stream.assumed.sse.txt` — `data:` lines carrying one JSON
 * ContentSection each, blank-line separated, terminated by `data: [DONE]`.
 * Anything outside that shape is a T3Q_MALFORMED_RESPONSE, never a partial
 * result.
 */

export const LEGACY_SSE_DONE = '[DONE]';

export class LegacySseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegacySseError';
  }
}

/**
 * Parses a complete SSE transcript into raw data payloads (JSON-decoded).
 * The whole body is required: a stream that ends without [DONE] was cut
 * mid-flight and must fail loudly (no partial trees — same rule as guards).
 */
export function parseLegacySseTranscript(body: string): unknown[] {
  const payloads: unknown[] = [];
  let done = false;
  // SSE events are separated by blank lines; multiple data: lines in one
  // event concatenate with newline (WHATWG EventSource semantics).
  for (const rawEvent of body.split(/\r?\n\r?\n/)) {
    if (done && rawEvent.trim().length > 0) {
      throw new LegacySseError('data after [DONE] sentinel');
    }
    const dataLines = [];
    for (const line of rawEvent.split(/\r?\n/)) {
      if (line.length === 0 || line.startsWith(':')) continue; // comment/keepalive
      const match = /^data:\s?(.*)$/.exec(line);
      if (!match) {
        throw new LegacySseError(`unexpected SSE line: ${line.slice(0, 80)}`);
      }
      dataLines.push(match[1]);
    }
    if (dataLines.length === 0) continue;
    const data = dataLines.join('\n');
    if (data === LEGACY_SSE_DONE) {
      done = true;
      continue;
    }
    try {
      payloads.push(JSON.parse(data));
    } catch {
      throw new LegacySseError(`SSE data frame is not valid JSON: ${data.slice(0, 80)}`);
    }
  }
  if (!done) {
    throw new LegacySseError('stream ended without [DONE] sentinel (truncated response)');
  }
  return payloads;
}
