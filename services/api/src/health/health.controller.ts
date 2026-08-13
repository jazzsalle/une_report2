import { Controller, Get, Header, HttpCode, Inject } from '@nestjs/common';
import type { ObjectStoragePort } from '@une/provider-adapters';
import { Public } from '../common/decorators';
import { OBJECT_STORAGE } from '../common/storage.provider';
import { METRICS, type MetricsRegistry } from '../common/observability/metrics';
import { DatabaseService } from '../db/database.service';

export interface HealthReport {
  status: 'ok';
  service: 'une-api';
  timestamp: string;
}

export interface ReadinessReport {
  status: 'ready' | 'degraded';
  service: 'une-api';
  timestamp: string;
  checks: Array<{ name: string; ok: boolean; latencyMs: number; error?: string }>;
}

/**
 * 살아 있음과 준비됨을 가른다 (CC-430).
 *
 * 지금까지 `/health`는 언제나 `ok`를 돌려줬다. 그것은 **프로세스가 떠 있다**만
 * 말하고, 오케스트레이터가 알아야 할 "트래픽을 보내도 되는가"에는 답하지 않는다.
 * DB가 죽은 채로 `ok`를 돌려주면 로드밸런서가 계속 요청을 보내고, 사용자는
 * 500을 받는다.
 *
 *   `/health`, `/health/live`  프로세스가 응답한다. 의존성을 보지 않는다 —
 *                              liveness가 의존성에 걸리면 DB 장애가 컨테이너
 *                              재시작 폭풍이 된다.
 *   `/health/ready`            DB와 객체 저장소에 실제로 물어본다. 하나라도
 *                              안 되면 `degraded` + 503.
 *
 * 오류 문구를 그대로 싣는 이유는 이 엔드포인트가 운영자용이기 때문이다.
 * 접속 문자열·자격증명은 문구에 들어가지 않는다(드라이버가 넣지 않는다).
 */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
  ) {}

  @Get()
  @Public()
  health(): HealthReport {
    return this.live();
  }

  @Get('live')
  @Public()
  live(): HealthReport {
    return {
      status: 'ok',
      service: 'une-api',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @Public()
  @HttpCode(200)
  async ready(): Promise<ReadinessReport> {
    // **준비 점검은 던지지 않는다.** 여기서 예외가 나면 오케스트레이터는 500을
    // 받고 "왜 준비가 안 됐는지"를 잃는다 — 그것이 이 엔드포인트의 전부다.
    const [database, objectStorage] = await Promise.all([
      probe(() => this.db.ping()),
      this.pingStorage(),
    ]);
    const checks = [
      { name: 'database', ...database },
      { name: 'objectStorage', ...objectStorage },
    ];
    return {
      status: checks.every((c) => c.ok) ? 'ready' : 'degraded',
      service: 'une-api',
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  /**
   * 없는 키를 `head`로 물어본다.
   *
   * 쓰기로 확인하면 준비 점검이 매번 객체를 만들고, 그것을 지우는 경로가 또
   * 필요해진다. `head`는 "없음"을 `null`로 돌려주므로(포트 계약) **없다는 답이
   * 곧 정상**이다 — 저장소가 죽어 있으면 예외가 온다.
   */
  private async pingStorage(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const started = Date.now();
    try {
      await this.storage.head('__health__/probe');
      return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, error: (err as Error).message };
    }
  }
}

/** 점검 하나를 감싼다 — 던지면 실패로 접고 사유를 남긴다. */
async function probe(
  fn: () => Promise<{ ok: boolean; latencyMs: number; error?: string }>,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    return await fn();
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, error: (err as Error).message };
  }
}

/**
 * Prometheus 노출 엔드포인트 (CC-430).
 *
 * `@Public`이다 — 수집기는 사용자 토큰을 갖지 않는다. 대신 **본문에 개인정보도
 * 테넌트 식별자도 들어가지 않는다**: 라벨은 경로 템플릿·메서드·상태 코드뿐이다.
 * 배포에서는 이 경로를 내부망으로만 노출한다(OB-14).
 */
@Controller('metrics')
export class MetricsController {
  constructor(@Inject(METRICS) private readonly metrics: MetricsRegistry) {}

  @Get()
  @Public()
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  scrape(): string {
    return this.metrics.render();
  }
}
