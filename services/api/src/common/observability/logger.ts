/**
 * 구조화 로그 (CC-430).
 *
 * 지금까지 로그는 `console.warn`/`console.error`가 흩어져 있었다. 그것으로는
 * 세 가지를 못 한다 — 상관관계 추적(한 요청이 남긴 줄을 모으기), 검색(필드로
 * 거르기), **누락 방지**(무엇을 찍으면 안 되는지 한 곳에서 정하기).
 *
 * 특히 마지막이 규칙이다. `.claude/rules/backend.md`가 금지하는 것은
 * "액세스 토큰, 개인정보가 담긴 provider 원문, 문서 본문을 INFO로 남기는 것"인데,
 * 금지를 각 호출 지점에 맡기면 언젠가 한 곳이 어긴다. 여기서 **나가는 길목에**
 * 두면 어길 자리가 하나뿐이다.
 *
 * 형식은 JSON 한 줄이다. 사람이 읽는 것보다 모으는 것이 먼저다 — 컨테이너
 * 로그를 수집기가 읽는 것이 배포 형태이기 때문이다(OB-14).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * 값이 통째로 지워지는 필드 이름.
 *
 * 이름으로 지운다 — 값의 모양으로 판정하면 놓치고, 놓친 것은 로그에 영구히
 * 남는다. 부분 일치를 쓰는 이유는 `accessToken`·`refresh_token`·`authorization`이
 * 모두 잡혀야 하기 때문이다.
 */
const REDACT_PATTERNS = [
  'password',
  'secret',
  'token',
  'authorization',
  'cookie',
  'apikey',
  'api_key',
  'credential',
  'sha256', // 파일 해시는 식별자로 쓰일 수 있다
];

/** 본문·원문이 통째로 들어오는 자리. 길이만 남긴다. */
const SIZE_ONLY_KEYS = ['payload', 'rawPayload', 'raw_payload_json', 'body', 'ir', 'irJson'];

const MAX_STRING = 500;

function redactValue(key: string, value: unknown, depth: number): unknown {
  const lower = key.toLowerCase();
  if (REDACT_PATTERNS.some((p) => lower.includes(p))) return '[redacted]';
  if (SIZE_ONLY_KEYS.some((p) => lower === p.toLowerCase())) {
    if (value === null || value === undefined) return value;
    const size = typeof value === 'string' ? value.length : (JSON.stringify(value)?.length ?? 0);
    return `[${size} bytes omitted]`;
  }
  return redact(value, depth + 1);
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[depth limit]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…(${value.length})` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack?.split('\n', 4) };
  }
  if (Array.isArray(value)) {
    // 배열은 앞 20개만. 전부 찍으면 한 줄이 로그를 덮는다.
    return value.slice(0, 20).map((v) => redact(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(k, v, depth);
    }
    return out;
  }
  return String(value);
}

export interface LogFields {
  correlationId?: string | null;
  requestId?: string | null;
  tenantId?: string | null;
  userId?: string | null;
  [key: string]: unknown;
}

export interface StructuredLogger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** 하위 로거 — 요청 단위 필드를 매번 다시 적지 않기 위해. */
  child(bound: LogFields): StructuredLogger;
}

export interface LoggerOptions {
  service: string;
  level?: LogLevel;
  /** 테스트가 줄을 가로챌 수 있게 열어 둔다. 기본은 stdout/stderr. */
  sink?: (line: string, level: LogLevel) => void;
  /** 시각 주입 — 테스트가 고정할 수 있어야 한다. */
  now?: () => Date;
}

function defaultSink(line: string, level: LogLevel): void {
  // 경고 이상은 stderr로 — 컨테이너 로그 수집기가 심각도를 스트림으로 가른다.
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export function createLogger(options: LoggerOptions): StructuredLogger {
  const min = LEVEL_ORDER[options.level ?? 'info'];
  const sink = options.sink ?? defaultSink;
  const now = options.now ?? (() => new Date());

  const emit = (level: LogLevel, bound: LogFields, message: string, fields?: LogFields): void => {
    if (LEVEL_ORDER[level] < min) return;
    const line = {
      ts: now().toISOString(),
      level,
      service: options.service,
      msg: message,
      ...(redact({ ...bound, ...(fields ?? {}) }) as Record<string, unknown>),
    };
    try {
      sink(JSON.stringify(line), level);
    } catch {
      // 로그가 애플리케이션을 죽이지 않는다. 순환 참조 같은 것이 여기로 온다.
      sink(JSON.stringify({ ts: line.ts, level, service: options.service, msg: message }), level);
    }
  };

  const make = (bound: LogFields): StructuredLogger => ({
    debug: (m, f) => emit('debug', bound, m, f),
    info: (m, f) => emit('info', bound, m, f),
    warn: (m, f) => emit('warn', bound, m, f),
    error: (m, f) => emit('error', bound, m, f),
    child: (extra) => make({ ...bound, ...extra }),
  });

  return make({});
}
