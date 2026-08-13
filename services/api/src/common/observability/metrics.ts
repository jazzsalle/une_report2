/**
 * 최소 메트릭 레지스트리 (CC-430).
 *
 * Prometheus 텍스트 노출 형식만 낸다. `prom-client` 같은 의존을 더하지 않은
 * 이유는 여기서 필요한 것이 카운터 하나와 히스토그램 하나뿐이고, 그 둘을 위해
 * 런타임 의존을 늘리면 SBOM과 취약점 추적 대상이 함께 늘기 때문이다.
 *
 * **트레이스는 이 항목에 없다.** 트레이스는 수집기(OTLP 엔드포인트)가 있어야
 * 의미가 있고, 그 주소는 배포 환경에 딸린 값이다(OB-14가 아직 열려 있다).
 * 대신 W3C `traceparent`를 받아 상관관계 ID와 이어 두었으므로, 수집기가 생기면
 * 내보내는 쪽만 붙이면 된다 — ADR-48 수용 한계에 적었다.
 */

export interface HistogramSnapshot {
  buckets: ReadonlyArray<{ le: number; count: number }>;
  sum: number;
  count: number;
}

/** 요청 지연 버킷(ms). 설계 목표가 5초·300ms이므로 그 둘을 경계로 둔다. */
const DEFAULT_BUCKETS = [5, 10, 25, 50, 100, 300, 500, 1000, 2500, 5000, 10000];

function labelKey(labels: Record<string, string>): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(',');
}

function renderLabels(labels: Record<string, string>, extra?: Record<string, string>): string {
  const all = { ...labels, ...(extra ?? {}) };
  const keys = Object.keys(all).sort();
  if (keys.length === 0) return '';
  const body = keys
    .map((k) => `${k}="${String(all[k]).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',');
  return `{${body}}`;
}

class Counter {
  private readonly values = new Map<string, { labels: Record<string, string>; value: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  inc(labels: Record<string, string> = {}, by = 1): void {
    const key = labelKey(labels);
    const found = this.values.get(key);
    if (found) found.value += by;
    else this.values.set(key, { labels, value: by });
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const { labels, value } of this.values.values()) {
      lines.push(`${this.name}${renderLabels(labels)} ${value}`);
    }
    return lines.join('\n');
  }
}

class Histogram {
  private readonly series = new Map<
    string,
    { labels: Record<string, string>; counts: number[]; sum: number; count: number }
  >();
  constructor(
    readonly name: string,
    readonly help: string,
    readonly buckets: readonly number[] = DEFAULT_BUCKETS,
  ) {}

  observe(value: number, labels: Record<string, string> = {}): void {
    const key = labelKey(labels);
    let s = this.series.get(key);
    if (!s) {
      s = { labels, counts: new Array(this.buckets.length).fill(0), sum: 0, count: 0 };
      this.series.set(key, s);
    }
    s.sum += value;
    s.count += 1;
    for (let i = 0; i < this.buckets.length; i += 1) {
      if (value <= this.buckets[i]) s.counts[i] += 1;
    }
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const s of this.series.values()) {
      let cumulative = 0;
      for (let i = 0; i < this.buckets.length; i += 1) {
        cumulative = s.counts[i];
        lines.push(
          `${this.name}_bucket${renderLabels(s.labels, { le: String(this.buckets[i]) })} ${cumulative}`,
        );
      }
      lines.push(`${this.name}_bucket${renderLabels(s.labels, { le: '+Inf' })} ${s.count}`);
      lines.push(`${this.name}_sum${renderLabels(s.labels)} ${s.sum}`);
      lines.push(`${this.name}_count${renderLabels(s.labels)} ${s.count}`);
    }
    return lines.join('\n');
  }

  snapshot(labels: Record<string, string> = {}): HistogramSnapshot | null {
    const s = this.series.get(labelKey(labels));
    if (!s) return null;
    return {
      buckets: this.buckets.map((le, i) => ({ le, count: s.counts[i] })),
      sum: s.sum,
      count: s.count,
    };
  }
}

/**
 * 프로세스 하나에 레지스트리 하나.
 *
 * 요청 라벨에 **경로 템플릿**을 쓴다(`/situations/:id`). 실제 경로를 쓰면
 * UUID마다 시계열이 하나씩 생겨 수집기가 터진다(cardinality explosion).
 */
export class MetricsRegistry {
  readonly httpRequests = new Counter('une_http_requests_total', 'HTTP 요청 수');
  readonly httpDuration = new Histogram('une_http_request_duration_ms', 'HTTP 요청 처리 시간(ms)');
  readonly errors = new Counter('une_errors_total', '처리되지 않은 오류 수');

  observeRequest(route: string, method: string, status: number, durationMs: number): void {
    const labels = { route, method, status: String(status) };
    this.httpRequests.inc(labels);
    // 지연 히스토그램에는 status를 넣지 않는다 — 라벨이 곱해지면 시계열이
    // 상태 코드 수만큼 늘어난다.
    this.httpDuration.observe(durationMs, { route, method });
  }

  render(): string {
    return `${[this.httpRequests.render(), this.httpDuration.render(), this.errors.render()].join('\n')}\n`;
  }
}

export const METRICS = Symbol('METRICS');
