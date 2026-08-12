import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { ApiCallError, describeFailure, nextActionFor } from '../api/errors';
import type { ApiClient } from '../api/client';
import {
  BoardApi,
  type DashboardView,
  type ExecutionEventDetail,
  type ExecutionEventPage,
} from './board-api';
import {
  BOARD_SCREEN_LABELS,
  boardScreenState,
  isPointInTime,
  kpiCards,
  divergenceWarning,
  provenanceNote,
  sortBoardTasks,
} from './board-state';

/**
 * 전자상황판 (CC-290, 설계 09 SCR-BOARD-001).
 *
 * Desktop 1280px 우선, Wall display. REG-01 KPI · REG-02 Timeline ·
 * REG-03 Task Grid · REG-04 Situation Panel · REG-05 Event Drill-down.
 *
 * **자동갱신은 폴링이다.** 설계 B표가 "SSE/reconnect"를 적지만 상황 단위 SSE
 * 엔드포인트가 설계 10에 없다 — 실행 단위 SSE(UNE-SOP-013)는 있으나 판은 여러
 * 실행을 함께 본다. 폴링 주기와 마지막 갱신 시각을 화면이 밝히므로 사용자가
 * 무엇을 보고 있는지 안다(ADR-43 수용 한계).
 */

const REFRESH_MS = 10_000;

const TONE_COLORS: Record<string, string> = {
  neutral: '#334155',
  active: '#1d4ed8',
  good: '#15803d',
  warn: '#b45309',
  bad: '#b91c1c',
};

const panel: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  padding: '0.75rem',
  background: '#ffffff',
};

const cell: React.CSSProperties = {
  padding: '0.35rem 0.5rem',
  borderBottom: '1px solid #f1f5f9',
  textAlign: 'left',
  fontSize: '0.85rem',
};

export function SituationBoard({
  client,
  situationId,
}: {
  client: ApiClient;
  situationId: string;
}): JSX.Element {
  const api = useMemo(() => new BoardApi(client), [client]);

  const [view, setView] = useState<DashboardView | null>(null);
  const [page, setPage] = useState<ExecutionEventPage | null>(null);
  const [detail, setDetail] = useState<ExecutionEventDetail | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [lastFetchFailed, setLastFetchFailed] = useState(false);
  const [at, setAt] = useState('');
  const [runId, setRunId] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [paused, setPaused] = useState(false);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [replacement, setReplacement] = useState('{\n  "note": ""\n}');
  const mounted = useRef(true);

  const report = useCallback((error: unknown) => {
    if (error instanceof ApiCallError) {
      setFailure(
        [describeFailure(error.failure), nextActionFor(error.failure)].filter(Boolean).join('\n'),
      );
    } else {
      setFailure(String(error));
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const [dashboard, events] = await Promise.all([
        api.dashboard(situationId, at || undefined, runId || undefined),
        api.events(situationId, { type: typeFilter || undefined, size: 50 }),
      ]);
      if (!mounted.current) return;
      setView(dashboard);
      setPage(events);
      setLastFetchFailed(false);
      setFailure(null);
    } catch (error) {
      if (!mounted.current) return;
      // **마지막으로 받은 값을 지우지 않는다.** 비우면 화면이 "아무 일도
      // 없다"로 보이고, 그것이 연결 실패보다 위험하다.
      setLastFetchFailed(true);
      report(error);
    }
  }, [api, situationId, at, runId, typeFilter, report]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  useEffect(() => {
    // 과거 시점을 보고 있으면 갱신하지 않는다 — 고정된 판이다.
    if (paused || at) return;
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [paused, at, load]);

  if (!view) {
    return (
      <main style={{ fontFamily: 'sans-serif', padding: '1rem' }}>
        <h1 style={{ fontSize: '1.25rem' }}>전자상황판</h1>
        {failure ? (
          <pre style={{ whiteSpace: 'pre-wrap', color: '#b91c1c' }}>{failure}</pre>
        ) : (
          <p>불러오는 중…</p>
        )}
      </main>
    );
  }

  const screen = boardScreenState({
    situationStatus: view.status,
    stale: view.stale,
    lastFetchFailed,
    userScrolling: paused,
  });
  const pointInTime = isPointInTime(view, new Date());
  const tasks = sortBoardTasks(view.tasks);

  return (
    <main
      style={{ fontFamily: 'sans-serif', padding: '1rem', maxWidth: '1600px', margin: '0 auto' }}
    >
      <header style={{ display: 'flex', gap: '1rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.25rem', margin: 0 }}>{view.title}</h1>
        <span style={{ fontWeight: 700, color: view.mode === 'LIVE' ? '#b91c1c' : '#7c3aed' }}>
          {view.mode === 'LIVE' ? '● 실제 상황' : '▲ 훈련'}
        </span>
        <span style={{ color: '#475569' }}>{view.status}</span>
        <span style={{ color: screen === 'LIVE' ? '#15803d' : '#b45309' }}>
          {BOARD_SCREEN_LABELS[screen]}
        </span>
        {view.lastEventAt && (
          <span style={{ color: '#64748b', fontSize: '0.85rem' }}>
            마지막 이벤트 {new Date(view.lastEventAt).toLocaleString('ko-KR')}
          </span>
        )}
      </header>

      {/* 과거 판을 실시간으로 착각하면 지휘 판단이 틀린다. */}
      {pointInTime && (
        <p
          style={{
            background: '#fef3c7',
            border: '1px solid #fcd34d',
            borderRadius: '8px',
            padding: '0.5rem 0.75rem',
          }}
        >
          ⏱ <strong>{new Date(view.at).toLocaleString('ko-KR')} 시점의 판</strong>입니다. 자동
          갱신이 멈춰 있습니다.
        </p>
      )}

      <section style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', margin: '0.75rem 0' }}>
        <label>
          시점{' '}
          <input
            type="datetime-local"
            value={at}
            onChange={(e) => setAt(e.target.value ? new Date(e.target.value).toISOString() : '')}
          />
        </label>
        <button onClick={() => setAt('')}>지금으로</button>
        <label>
          실행{' '}
          <select value={runId} onChange={(e) => setRunId(e.target.value)}>
            <option value="">전체</option>
            {view.runs.map((r) => (
              <option key={r.runId} value={r.runId}>
                {r.mode} · {r.status} · {new Date(r.startedAt).toLocaleString('ko-KR')}
              </option>
            ))}
          </select>
        </label>
        <label>
          이벤트 종류{' '}
          <input
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            placeholder="TASK_COMPLETED"
          />
        </label>
        <button onClick={() => setPaused((v) => !v)}>
          {paused ? '자동갱신 켜기' : '자동갱신 끄기'}
        </button>
        <button onClick={() => void load()}>새로고침</button>
      </section>

      {failure && <pre style={{ whiteSpace: 'pre-wrap', color: '#b91c1c' }}>{failure}</pre>}

      {/* REG-01 KPI Bar */}
      <section style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {kpiCards(view).map((card) => (
          <div key={card.key} style={{ ...panel, minWidth: '96px' }}>
            <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{card.label}</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, color: TONE_COLORS[card.tone] }}>
              {card.value}
            </div>
          </div>
        ))}
      </section>
      <p style={{ fontSize: '0.75rem', color: '#64748b' }}>{provenanceNote(view)}</p>
      {divergenceWarning(view) && (
        <p
          style={{
            background: '#fee2e2',
            border: '1px solid #fca5a5',
            borderRadius: '8px',
            padding: '0.5rem 0.75rem',
          }}
        >
          {divergenceWarning(view)}
        </p>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)',
          gap: '1rem',
        }}
      >
        {/* REG-03 Task Grid */}
        <section style={panel}>
          <h2 style={{ fontSize: '1rem' }}>임무 ({tasks.length})</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={cell}>단계</th>
                  <th style={cell}>임무</th>
                  <th style={cell}>상태</th>
                  <th style={cell}>진행</th>
                  <th style={cell}>기한</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.taskId} style={t.overdue ? { background: '#fef2f2' } : undefined}>
                    <td style={cell}>{t.nodeKey}</td>
                    <td style={cell}>{t.title}</td>
                    <td style={cell}>{t.status}</td>
                    <td style={cell}>{t.progressPct}%</td>
                    <td style={cell}>
                      {t.dueAt ? new Date(t.dueAt).toLocaleString('ko-KR') : '—'}
                      {t.overdue ? ' ⚠' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div style={{ display: 'grid', gap: '1rem' }}>
          {/* REG-04 Situation Panel */}
          <section style={panel}>
            <h2 style={{ fontSize: '1rem' }}>상황 판</h2>
            {view.snapshot ? (
              <p style={{ fontSize: '0.85rem' }}>
                v{view.snapshot.versionNo} · 사실 {view.snapshot.factCount}건 ·{' '}
                {new Date(view.snapshot.effectiveAt).toLocaleString('ko-KR')}
              </p>
            ) : (
              <p style={{ fontSize: '0.85rem', color: '#64748b' }}>확정된 판이 아직 없습니다.</p>
            )}
          </section>

          {/* REG-02 Timeline */}
          <section style={panel}>
            <h2 style={{ fontSize: '1rem' }}>타임라인 ({page?.total ?? 0})</h2>
            <ul style={{ listStyle: 'none', padding: 0, maxHeight: '420px', overflowY: 'auto' }}>
              {(page?.items ?? []).map((e) => (
                <li
                  key={e.eventId}
                  style={{ borderBottom: '1px solid #f1f5f9', padding: '0.35rem 0' }}
                >
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    {new Date(e.occurredAt).toLocaleString('ko-KR')} · {e.aggregateType}
                  </div>
                  <div>
                    <strong>{e.eventType}</strong>
                    {/* 원본을 감추지 않고 표시만 단다(REG-05). */}
                    {e.correctedBy && <span style={{ color: '#b45309' }}> · 정정됨</span>}
                    {e.correctsEventId && <span style={{ color: '#7c3aed' }}> · 정정 이벤트</span>}
                  </div>
                  <button onClick={() => void api.event(e.eventId).then(setDetail).catch(report)}>
                    상세
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      {/* REG-05 Event Drill-down */}
      {detail && (
        <section style={{ ...panel, marginTop: '1rem' }}>
          <h2 style={{ fontSize: '1rem' }}>이벤트 상세</h2>
          <button onClick={() => setDetail(null)}>닫기</button>
          <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
            {detail.event.eventType} · {new Date(detail.event.occurredAt).toLocaleString('ko-KR')} ·
            hash {detail.event.eventHash.slice(0, 12)}…
          </p>

          <h3 style={{ fontSize: '0.9rem' }}>원본</h3>
          <pre style={{ background: '#f8fafc', padding: '0.5rem', overflowX: 'auto' }}>
            {JSON.stringify(detail.event.payload, null, 2)}
          </pre>

          {detail.corrections.length > 0 && (
            <>
              <h3 style={{ fontSize: '0.9rem' }}>
                정정 {detail.corrections.length}건 (마지막이 유효본)
              </h3>
              <ul style={{ fontSize: '0.85rem' }}>
                {detail.corrections.map((c) => (
                  <li key={c.eventId}>
                    {new Date(c.recordedAt).toLocaleString('ko-KR')} ·{' '}
                    {String(c.payload.reason ?? '')} ·{' '}
                    {JSON.stringify(c.payload.replacementFields ?? {})}
                  </li>
                ))}
              </ul>
              <h3 style={{ fontSize: '0.9rem' }}>지금 사실</h3>
              <pre style={{ background: '#f0fdf4', padding: '0.5rem', overflowX: 'auto' }}>
                {JSON.stringify(detail.effectivePayload, null, 2)}
              </pre>
            </>
          )}

          {detail.correctable ? (
            <div>
              <h3 style={{ fontSize: '0.9rem' }}>정정</h3>
              <p style={{ fontSize: '0.8rem', color: '#64748b' }}>
                원본은 그대로 남습니다. 새 정정 이벤트가 추가됩니다.
              </p>
              <label htmlFor="reason">사유</label>
              <input
                id="reason"
                style={{ width: '100%' }}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <label htmlFor="fields">바꿀 값 (JSON)</label>
              <textarea
                id="fields"
                style={{ width: '100%', minHeight: '80px', fontFamily: 'monospace' }}
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
              />
              {/* **되돌릴 수 없다.** 사실원장은 append-only라 정정을 취소할 수
                  없고 덮어쓸 수만 있다. 실행 강제종료가 확인코드를 요구하는 것과
                  같은 무게의 조작이다. */}
              {!confirming ? (
                <button onClick={() => setConfirming(true)} disabled={reason.trim().length === 0}>
                  정정 내용 확인
                </button>
              ) : (
                <div
                  style={{ border: '1px solid #fcd34d', borderRadius: '8px', padding: '0.5rem' }}
                >
                  <p style={{ margin: 0, fontSize: '0.85rem' }}>
                    <strong>되돌릴 수 없습니다.</strong> 원본은 그대로 남지만 정정은 취소할 수 없고
                    덮어쓸 수만 있습니다. 감사 기록에 남습니다.
                  </p>
                  <p style={{ fontSize: '0.8rem', color: '#475569' }}>사유: {reason}</p>
                  <pre style={{ background: '#f8fafc', padding: '0.5rem', overflowX: 'auto' }}>
                    {replacement}
                  </pre>
                  <button onClick={() => setConfirming(false)}>취소</button>
                  <button
                    onClick={() => {
                      let fields: Record<string, unknown>;
                      try {
                        fields = JSON.parse(replacement) as Record<string, unknown>;
                      } catch {
                        setFailure('바꿀 값이 올바른 JSON이 아닙니다.');
                        return;
                      }
                      setConfirming(false);
                      void api
                        .correct(detail.event.eventId, { reason, replacementFields: fields })
                        .then(() => api.event(detail.event.eventId))
                        .then(setDetail)
                        .then(() => void load())
                        .catch(report);
                    }}
                  >
                    정정 등록
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
              시스템이 기록한 사실은 정정할 수 없습니다 — 새 조치(재전파·반려·재배정)로
              바로잡습니다.
            </p>
          )}
        </section>
      )}
    </main>
  );
}
