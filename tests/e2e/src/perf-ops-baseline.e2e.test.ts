import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_URL, apiFor, idem, startHarness, withClient, type Harness } from './harness';
import { percentiles } from './synthetic-corpus';

/**
 * 상황·실행 경로 성능 기준선 (CC-430).
 *
 * CC-170의 기준선은 계획서·HWPX 경로를 쟀다. 남은 것은 **훈련이 도는 동안
 * 사람이 계속 보고 있는 화면들**이다 — 전자상황판, 실행 로그, 임무 목록.
 * 이쪽이 느리면 대응 중에 화면이 멈춘다.
 *
 * 설계에 이 경로들의 목표치는 없다. 그래서 **실측을 기준선으로 등록**한다
 * (CC-170이 Export에 한 것과 같은 방식). 다만 조회 화면이므로 편집 목표치
 * 300ms를 참고선으로 함께 적는다 — 넘으면 실패가 아니라 **왜 넘었는지**를
 * 증거 문서에 적어야 한다.
 *
 * 실패로 만들지 않는 이유는 CC-170이 적은 그대로다: 게이트로 만들면 다음
 * 사람이 목표치를 낮춰 통과시킨다.
 *
 * 부하는 **읽을 것이 있는 상태**여야 의미가 있다. 빈 상황을 재면 "아무것도
 * 없을 때 빠르다"만 증명한다. 그래서 사실·임무·사건을 심어 두고 잰다 —
 * 이 파일에서 SQL을 쓰는 유일한 이유이며, 경로 자체는 API로 잰다.
 */

const REFERENCE_MS = 300;
const RUNS = 20;
/** 심는 부하. 훈련 하나가 남기는 양의 대략치. */
const FACTS = 200;
const TASKS = 60;
const EVENTS = 600;

/** 상태와 진행률은 짝이다 — DB의 CHECK가 어긋난 조합을 막는다. */
const STATUSES = [
  { status: 'CREATED', progress: 0 },
  { status: 'SENT', progress: 0 },
  { status: 'ACKNOWLEDGED', progress: 0 },
  { status: 'IN_PROGRESS', progress: 50 },
  { status: 'COMPLETED', progress: 100 },
] as const;

interface Measured {
  label: string;
  p50: number;
  p95: number;
  max: number;
  overReference: boolean;
}

describe.skipIf(!ADMIN_URL)('상황·실행 경로 성능 기준선 (CC-430)', () => {
  let h: Harness;
  let api: ReturnType<typeof apiFor>;
  let token: string;
  let situationId: string;
  const results: Measured[] = [];

  const measure = async (label: string, run: () => Promise<void>): Promise<Measured> => {
    // 예열 — 첫 요청은 연결 수립·계획 캐시 때문에 다른 분포에 있다.
    for (let i = 0; i < 3; i += 1) await run();
    const samples: number[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      const started = performance.now();
      await run();
      samples.push(performance.now() - started);
    }
    const stats = percentiles(samples);
    const measured: Measured = {
      label,
      p50: Math.round(stats.p50),
      p95: Math.round(stats.p95),
      max: Math.round(stats.max),
      overReference: stats.p95 > REFERENCE_MS,
    };
    results.push(measured);
    return measured;
  };

  const get = async (path: string): Promise<void> => {
    const res = await api.call('GET', path, token);
    if (res.status !== 200) throw new Error(`${path} → ${res.status}`);
    await res.text();
  };

  beforeAll(async () => {
    h = await startHarness('cc430_perf');
    api = apiFor(h);
    token = await api.login(h.fixtures.tenantA, 'admin-a');

    const created = await api.call('POST', '/api/v1/situations', token, {
      body: { mode: 'EXERCISE', title: 'CC-430 성능 기준선', hazardType: '태풍/호우' },
      idempotencyKey: idem('perf-situation'),
    });
    situationId = ((await created.json()) as { data: { situationId: string } }).data.situationId;

    // 부하를 심는다. API로 200건을 넣으면 준비에만 몇 분이 걸리고, 여기서
    // 재려는 것은 **읽는 경로**이지 넣는 경로가 아니다.
    await withClient(h.dbUrl, async (c) => {
      const source = (
        await c.query(
          `INSERT INTO fact_source
             (tenant_id, provider_code, source_type, source_name, retrieved_at)
           VALUES ($1,'MANUAL','USER','성능 기준선', now()) RETURNING source_id`,
          [h.fixtures.tenantA],
        )
      ).rows[0].source_id as string;
      for (let i = 0; i < FACTS; i += 1) {
        await c.query(
          `INSERT INTO situation_fact
             (situation_id, fact_type, fact_key, value_json, source_id, observed_at,
              collected_at, confidence, status)
           VALUES ($1,'WEATHER_OBSERVATION','rainfall_1h', to_jsonb($2::numeric), $3,
                   now() - ($4 || ' minutes')::interval, now(), 0.9, 'CANDIDATE')`,
          [situationId, 10 + (i % 50), source, String(i)],
        );
      }

      const snapshotId = (
        await c.query(
          `INSERT INTO situation_snapshot
             (situation_id, version_no, facts_json, content_hash, effective_at, confirmed_by)
           VALUES ($1,1,'[{"factType":"WEATHER_OBSERVATION","factKey":"rainfall_1h","value":30}]'::jsonb,
                   $2,now(),$3) RETURNING snapshot_id`,
          [situationId, 'a'.repeat(64), h.fixtures.adminA],
        )
      ).rows[0].snapshot_id as string;
      await c.query(
        `UPDATE situation SET current_snapshot_id=$2, status='RUNNING' WHERE situation_id=$1`,
        [situationId, snapshotId],
      );

      const sopId = (
        await c.query(
          `INSERT INTO sop (tenant_id, situation_id, title, hazard_type, status, created_by)
           VALUES ($1,$2,'성능 SOP','FLOOD','APPROVED',$3) RETURNING sop_id`,
          [h.fixtures.tenantA, situationId, h.fixtures.adminA],
        )
      ).rows[0].sop_id as string;
      const versionId = (
        await c.query(
          // **DRAFT로 만들어 노드를 넣고 나중에 잠근다.** 승인된 버전의 그래프는
          // 0035가 막는다 — 순서를 뒤집으면 여기서 걸린다.
          `INSERT INTO sop_version (sop_id, version_no, status, graph_hash, schema_version, created_by)
           VALUES ($1,1,'DRAFT',$2,'sop-editor-1',$3) RETURNING sop_version_id`,
          [sopId, 'b'.repeat(64), h.fixtures.adminA],
        )
      ).rows[0].sop_version_id as string;
      // 노드를 먼저 넣는다 — 잠근 뒤에는 못 넣는다.
      const nodeIds: string[] = [];
      for (let i = 0; i < TASKS; i += 1) {
        nodeIds.push(
          (
            await c.query(
              `INSERT INTO sop_node (sop_version_id, node_key, node_type, title, config_json, sort_order)
               VALUES ($1,$2,'ACTION',$3,'{}'::jsonb,$4) RETURNING node_id`,
              [versionId, `n${i}`, `임무 ${i}`, i],
            )
          ).rows[0].node_id as string,
        );
      }
      await c.query(
        `UPDATE sop_version SET status='LOCKED', approved_by=$2, approved_at=now()
          WHERE sop_version_id=$1`,
        [versionId, h.fixtures.adminA],
      );

      const runId = (
        await c.query(
          `INSERT INTO sop_run
             (sop_version_id, situation_id, snapshot_id, mode, status, started_by, correlation_id)
           VALUES ($1,$2,$3,'EXERCISE','RUNNING',$4,'corr-cc430-perf') RETURNING run_id`,
          [versionId, situationId, snapshotId, h.fixtures.adminA],
        )
      ).rows[0].run_id as string;

      for (let i = 0; i < TASKS; i += 1) {
        const nodeId = nodeIds[i];
        await c.query(
          `INSERT INTO task
             (run_id, node_id, title, status, assignee_user_id, completion_policy_json,
              progress_pct, activated_at, due_at)
           VALUES ($1,$2,$3,$4,$5,'{}'::jsonb,$6, now(), now() + interval '1 hour')`,
          [
            runId,
            nodeId,
            `임무 ${i}`,
            STATUSES[i % STATUSES.length].status,
            h.fixtures.fieldA,
            // 진행률은 상태와 어긋날 수 없다(ck_task_progress_settled).
            STATUSES[i % STATUSES.length].progress,
          ],
        );
      }

      for (let i = 0; i < EVENTS; i += 1) {
        await c.query(
          `INSERT INTO execution_event
             (tenant_id, situation_id, aggregate_type, aggregate_id, event_type, actor_id,
              payload_json, event_hash, correlation_id, occurred_at)
           VALUES ($1,$2,'RUN',$3,'TASK_PROGRESS_REPORTED',$4,'{}'::jsonb,$5,'corr-cc430-perf',
                   now() - ($6 || ' seconds')::interval)`,
          [
            h.fixtures.tenantA,
            situationId,
            runId,
            h.fixtures.adminA,
            i.toString(16).padStart(64, '0'),
            String(EVENTS - i),
          ],
        );
      }
    });
  }, 900_000);

  afterAll(async () => {
    await h?.close();
    if (results.length > 0) {
      console.log(
        '\n[CC-430] 상황·실행 경로 기준선 (사실 %d · 임무 %d · 사건 %d, %d회)',
        FACTS,
        TASKS,
        EVENTS,
        RUNS,
      );
      for (const r of results) {
        console.log(
          `  ${r.label}: p50=${r.p50}ms p95=${r.p95}ms max=${r.max}ms` +
            `${r.overReference ? ` · 참고선 ${REFERENCE_MS}ms 초과` : ''}`,
        );
      }
    }
  });

  it('전자상황판(대시보드)', async () => {
    const m = await measure('대시보드', () => get(`/api/v1/situations/${situationId}/dashboard`));
    expect(m.p95).toBeGreaterThan(0);
  }, 600_000);

  it('실행 로그 한 쪽', async () => {
    const m = await measure('실행 로그(50건)', () =>
      get(`/api/v1/situations/${situationId}/execution-events?size=50`),
    );
    expect(m.p95).toBeGreaterThan(0);
  }, 600_000);

  it('상황 상세', async () => {
    const m = await measure('상황 상세', () => get(`/api/v1/situations/${situationId}`));
    expect(m.p95).toBeGreaterThan(0);
  }, 600_000);

  it('사실 목록 한 쪽', async () => {
    const m = await measure('사실 목록(50건)', () =>
      get(`/api/v1/situations/${situationId}/facts?size=50`),
    );
    expect(m.p95).toBeGreaterThan(0);
  }, 600_000);

  it('임무 목록', async () => {
    const m = await measure('임무 목록(50건)', () => get('/api/v1/tasks?size=50'));
    expect(m.p95).toBeGreaterThan(0);
  }, 600_000);

  it('기준선이 실제로 측정됐다', () => {
    // 측정이 0건이면 위의 단언들이 전부 공회전한 것이다.
    expect(results.length).toBeGreaterThanOrEqual(5);
    for (const r of results) expect(r.p50).toBeGreaterThan(0);
  });
});
