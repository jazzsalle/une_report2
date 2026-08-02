/**
 * target-v2 SSE framing — UNE ASSUMPTION (CC-135, ADR-28 D5, OB-10).
 *
 * The requested contract fixes only the EVENT NAMES in prose (job.started,
 * toc.section, content.block, job.warning, job.completed, job.failed,
 * heartbeat) and types the stream as an opaque string. Everything below —
 * `id:` == data.sequence, JSON data lines, comment-line heartbeats,
 * Last-Event-ID replay of id > k — is what UNE ASKS FOR, mirrored from the
 * legacy `.assumed` convention (legacy-sse.ts). When T3Q answers (CC-400)
 * this file is re-validated against provider truth, not the other way round.
 *
 * Terminal rule (same principle as the legacy `[DONE]` rule): a stream that
 * ends without job.completed/job.failed is NOT a partial result — the caller
 * must treat it as T3Q_MALFORMED_RESPONSE. The parser only enforces framing;
 * terminality is the adapter's check.
 */

export const TARGET_V2_TERMINAL_EVENTS = ['job.completed', 'job.failed'] as const;

export interface TargetV2SseFrame {
  /** SSE id; must equal data.sequence and increase strictly. */
  id: number;
  event: string;
  data: Record<string, unknown>;
}

export class TargetV2SseError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'TargetV2SseError';
  }
}

/** Serialize frames to an SSE transcript. A comment heartbeat is emitted
 * after the first frame so consumers must prove they skip comment lines. */
export function serializeTargetV2Sse(frames: readonly TargetV2SseFrame[]): string {
  const records: string[] = [];
  frames.forEach((frame, index) => {
    records.push(`id: ${frame.id}\nevent: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n`);
    if (index === 0) records.push(': heartbeat\n');
  });
  return records.join('\n');
}

/** Parse an SSE transcript into frames. Comment-only records (heartbeats)
 * are skipped; framing violations throw — the caller maps them to
 * T3Q_MALFORMED_RESPONSE with the raw transcript preserved. */
export function parseTargetV2Sse(transcript: string): TargetV2SseFrame[] {
  const frames: TargetV2SseFrame[] = [];
  let lastId = 0;
  const records = transcript.split(/\r?\n\r?\n/);
  records.forEach((record, index) => {
    const path = `/record/${index}`;
    const lines = record.split(/\r?\n/).filter((line) => line.length > 0);
    if (lines.length === 0) return;
    if (lines.every((line) => line.startsWith(':'))) return; // heartbeat/comment
    let id: number | undefined;
    let event: string | undefined;
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      if (colon === -1) throw new TargetV2SseError(path, `field line without colon: ${line}`);
      const field = line.slice(0, colon);
      const value = line.slice(colon + 1).replace(/^ /, '');
      if (field === 'id') {
        id = Number(value);
        if (!Number.isInteger(id) || id < 1) {
          throw new TargetV2SseError(`${path}/id`, `id must be a positive integer: ${value}`);
        }
      } else if (field === 'event') {
        event = value;
      } else if (field === 'data') {
        dataLines.push(value);
      } else {
        throw new TargetV2SseError(path, `unknown SSE field: ${field}`);
      }
    }
    if (id === undefined) throw new TargetV2SseError(`${path}/id`, 'missing id');
    if (!event) throw new TargetV2SseError(`${path}/event`, 'missing event');
    if (dataLines.length === 0) throw new TargetV2SseError(`${path}/data`, 'missing data');
    let data: unknown;
    try {
      data = JSON.parse(dataLines.join('\n'));
    } catch {
      throw new TargetV2SseError(`${path}/data`, 'data is not valid JSON');
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new TargetV2SseError(`${path}/data`, 'data must be a JSON object');
    }
    const sequence = (data as Record<string, unknown>).sequence;
    if (sequence !== id) {
      throw new TargetV2SseError(
        `${path}/data/sequence`,
        `sequence ${String(sequence)} != id ${id}`,
      );
    }
    if (id <= lastId) {
      throw new TargetV2SseError(
        `${path}/id`,
        `id ${id} is not strictly increasing (last ${lastId})`,
      );
    }
    lastId = id;
    frames.push({ id, event, data: data as Record<string, unknown> });
  });
  return frames;
}

export function isTerminalTargetV2Event(event: string): boolean {
  return (TARGET_V2_TERMINAL_EVENTS as readonly string[]).includes(event);
}
