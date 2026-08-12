import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import type { components } from '../generated/une-platform-api';
import { ApiCallError, FieldApiClient, isOffline, newIdempotencyKey } from '../api/client';
import { buildMockExternalToken } from './mock-sso';
import { localQueueStorage, OfflineQueue, type QueuedAction } from './offline-queue';
import {
  availableActions,
  completionBlockers,
  FIELD_STEPS,
  modeBadge,
  screenState,
  stepIndex,
  type FieldAction,
} from './state';

/**
 * 현장 임무 화면 (CC-280, 설계 09 SCR-TASK-001~003).
 *
 * 모바일 우선이다: 360~480px 기준, 주요 버튼 44px 이상, 한 손 조작.
 *
 * 설계 09는 라우트를 `/task/:signedToken`으로 적지만 **서명링크 인증을 만들지
 * 않았다** — 지금 그 링크를 배달할 채널이 없다(OB-06, ADR-42 D1). 그래서 이
 * 화면은 로그인한 담당자가 자기 임무를 여는 형태다.
 */

/** 계약에서 온다 — 화면이 응답 모양을 손으로 다시 적지 않는다. */
type TaskSummary = components['schemas']['Task'];
type TaskDetail = components['schemas']['TaskDetail'];
type TaskPage = components['schemas']['TaskPage'];

const ACTION_LABELS: Record<FieldAction, string> = {
  ACKNOWLEDGE: '수신확인',
  START: '착수',
  REPORT_PROGRESS: '진행보고',
  SUBMIT_COMPLETION: '완료 제출',
  REPORT_UNABLE: '수행불가 보고',
  ADD_ATTACHMENT: '사진·파일 첨부',
};

/**
 * 멱등 키에 들어가는 이름은 **ASCII여야 한다** — HTTP 헤더 값이기 때문이다.
 * 화면에 보이는 한국어 이름과 따로 두는 이유가 그것이다.
 */
const ACTION_KEYS: Record<FieldAction, string> = {
  ACKNOWLEDGE: 'ack',
  START: 'start',
  REPORT_PROGRESS: 'progress',
  SUBMIT_COMPLETION: 'complete',
  REPORT_UNABLE: 'unable',
  ADD_ATTACHMENT: 'attach',
};

const UNABLE_REASONS: { code: string; label: string }[] = [
  { code: 'SAFETY', label: '안전 위험' },
  { code: 'RESOURCE', label: '자원 부족' },
  { code: 'ACCESS', label: '접근 불가' },
  { code: 'UNCLEAR', label: '지시 불명확' },
  { code: 'OTHER', label: '기타' },
];

const TONE_COLORS: Record<string, string> = {
  info: '#334155',
  action: '#1d4ed8',
  warn: '#b45309',
  done: '#15803d',
};

const button = (primary: boolean): React.CSSProperties => ({
  // 44px은 한 손 조작 기준이다(설계 09 반응형·접근성).
  minHeight: '44px',
  width: '100%',
  padding: '0.75rem 1rem',
  marginTop: '0.5rem',
  fontSize: '1rem',
  borderRadius: '8px',
  border: primary ? 'none' : '1px solid #cbd5e1',
  background: primary ? '#1d4ed8' : '#ffffff',
  color: primary ? '#ffffff' : '#0f172a',
  cursor: 'pointer',
});

const field: React.CSSProperties = {
  width: '100%',
  minHeight: '44px',
  padding: '0.5rem',
  fontSize: '1rem',
  borderRadius: '8px',
  border: '1px solid #cbd5e1',
  boxSizing: 'border-box',
};

export function FieldTaskApp(): JSX.Element {
  const client = useMemo(() => new FieldApiClient(), []);
  const queue = useMemo(() => new OfflineQueue(localQueueStorage()), []);

  const [tenantId, setTenantId] = useState('');
  const [loginId, setLoginId] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<QueuedAction[]>(queue.list());
  const [busy, setBusy] = useState(false);

  const [progress, setProgress] = useState(50);
  const [note, setNote] = useState('');
  const [result, setResult] = useState('');
  const [checked, setChecked] = useState<string[]>([]);
  const [unableReason, setUnableReason] = useState('SAFETY');
  const [unableOpen, setUnableOpen] = useState(false);

  const refreshPending = useCallback(() => setPending(queue.list()), [queue]);

  const report = useCallback((error: unknown) => {
    if (error instanceof ApiCallError) {
      const f = error.failure;
      const detailText = f.violations?.map((v) => `${v.field}: ${v.reason}`).join(' / ');
      setFailure([`${f.message} (${f.code})`, detailText, f.userAction].filter(Boolean).join('\n'));
    } else {
      setFailure(String(error));
    }
  }, []);

  const loadTasks = useCallback(async () => {
    const page = await client.call<TaskPage>('/tasks?assignee=me&size=50');
    setTasks(page.items);
  }, [client]);

  const loadDetail = useCallback(
    async (taskId: string) => {
      setDetail(await client.call<TaskDetail>(`/tasks/${taskId}`));
    },
    [client],
  );

  /** 대기열 비우기 — 화면이 열릴 때, 그리고 연결이 돌아올 때. */
  const flush = useCallback(async () => {
    const outcome = await queue.flush(async (action) => {
      await client.call(action.path, {
        method: 'POST',
        body: action.body,
        idempotencyKey: action.idempotencyKey,
      });
    });
    refreshPending();
    if (outcome.rejected.length > 0) {
      setFailure(
        `서버가 거절한 대기 항목 ${outcome.rejected.length}건이 있습니다: ` +
          outcome.rejected.map((r) => `${r.label}(${r.lastError ?? '사유 없음'})`).join(', '),
      );
    }
    if (outcome.sent > 0) setNotice(`대기 중이던 ${outcome.sent}건을 보냈습니다.`);
    return outcome;
  }, [client, queue, refreshPending]);

  useEffect(() => {
    if (!signedIn) return;
    const onOnline = (): void => {
      void flush().then(() => loadTasks().catch(report));
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [signedIn, flush, loadTasks, report]);

  async function signIn(): Promise<void> {
    setBusy(true);
    setFailure(null);
    try {
      const session = await client.call<{
        accessToken: string;
        userContext: { userId: string };
      }>('/auth/sso/exchange', {
        method: 'POST',
        body: { externalToken: buildMockExternalToken({ tenantId, loginId }) },
      });
      client.setToken(session.accessToken);
      setUserId(session.userContext.userId);
      setSignedIn(true);
      await flush();
      await loadTasks();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  /**
   * 상태를 바꾸는 요청 하나.
   *
   * 네트워크가 없으면 대기열에 넣고 **성공한 척하지 않는다** — 화면에 "대기 중"
   * 이라고 적는다. 보냈다고 표시하면 사람이 지휘소가 알고 있다고 믿는다.
   */
  async function submit(
    taskId: string,
    path: string,
    body: unknown,
    action: FieldAction,
  ): Promise<void> {
    const label = ACTION_LABELS[action];
    setBusy(true);
    setFailure(null);
    setNotice(null);
    // **아직 못 보낸 같은 행위가 있으면 그 키를 그대로 쓴다.** 새로 만들면
    // 오프라인에서 두 번 누른 보고가 서로 다른 키로 쌓이고 복구 시 둘 다
    // 나간다 — 진행보고는 상태를 바꾸지 않아 중복이 그대로 남는다.
    const queued = queue.findPending(taskId, label);
    const idempotencyKey = queued?.idempotencyKey ?? newIdempotencyKey(ACTION_KEYS[action]);
    try {
      await client.call(path, { method: 'POST', body, idempotencyKey });
      await loadDetail(taskId);
      await loadTasks();
      setNotice(`${label} 완료`);
    } catch (error) {
      if (isOffline(error)) {
        queue.enqueue({
          id: idempotencyKey,
          taskId,
          path,
          body,
          idempotencyKey,
          label,
          queuedAt: new Date().toISOString(),
        });
        refreshPending();
        setNotice(`연결이 없어 ${label}을(를) 대기열에 넣었습니다. 복구되면 자동으로 보냅니다.`);
      } else {
        report(error);
        try {
          await loadDetail(taskId);
        } catch {
          // 상세 갱신 실패는 원래 오류를 덮지 않는다.
        }
      }
    } finally {
      setBusy(false);
    }
  }

  if (!signedIn) {
    return (
      <main
        style={{ fontFamily: 'sans-serif', padding: '1rem', maxWidth: '480px', margin: '0 auto' }}
      >
        <h1 style={{ fontSize: '1.25rem' }}>UNE 현장임무</h1>
        <p style={{ color: '#475569', fontSize: '0.9rem' }}>
          담당자 본인만 자기 임무를 볼 수 있습니다.
        </p>
        {/* 지금 로그인은 mock SSO뿐이다 - 실 SSO는 OB-01이 닫혀야 붙는다.
            그 사실을 감추면 실 환경에서 실패했을 때 원인을 알 수 없다. */}
        <p style={{ color: '#b45309', fontSize: '0.8rem' }}>
          ⚠ 이 화면의 로그인은 mock SSO(AUTH_MODE=mock)에서만 동작합니다. 실 SSO 연계는 OB-01 종결
          후 붙습니다.
        </p>
        <label htmlFor="tenant">기관 ID</label>
        <input
          id="tenant"
          style={field}
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
        />
        <label htmlFor="login" style={{ marginTop: '0.75rem', display: 'block' }}>
          로그인 ID
        </label>
        <input
          id="login"
          style={field}
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
        />
        <button style={button(true)} onClick={() => void signIn()} disabled={busy}>
          로그인
        </button>
        {failure && <pre style={{ whiteSpace: 'pre-wrap', color: '#b91c1c' }}>{failure}</pre>}
      </main>
    );
  }

  if (!detail) {
    return (
      <main
        style={{ fontFamily: 'sans-serif', padding: '1rem', maxWidth: '480px', margin: '0 auto' }}
      >
        <h1 style={{ fontSize: '1.25rem' }}>내 임무</h1>
        <QueueBanner pending={pending} onFlush={() => void flush()} />
        {notice && <p style={{ color: '#15803d' }}>{notice}</p>}
        {failure && <pre style={{ whiteSpace: 'pre-wrap', color: '#b91c1c' }}>{failure}</pre>}
        {tasks.length === 0 && <p>배정된 임무가 없습니다.</p>}
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {tasks.map((t) => (
            <li
              key={t.taskId}
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '0.75rem',
                marginBottom: '0.5rem',
              }}
            >
              <strong>{t.title}</strong>
              <div style={{ fontSize: '0.85rem', color: '#475569' }}>
                {t.status} · 진행 {t.progressPct}%
                {t.dueAt ? ` · 기한 ${new Date(t.dueAt).toLocaleString('ko-KR')}` : ''}
              </div>
              <button style={button(false)} onClick={() => void loadDetail(t.taskId).catch(report)}>
                열기
              </button>
            </li>
          ))}
        </ul>
        <button
          style={button(false)}
          onClick={() => void loadTasks().catch(report)}
          disabled={busy}
        >
          새로고침
        </button>
      </main>
    );
  }

  const task = detail.task;
  const isAssignee = task.assigneeUserId !== null && task.assigneeUserId === userId;
  const actions = availableActions(task.status, isAssignee);
  const lastEvent =
    detail.events.length > 0 ? detail.events[detail.events.length - 1].eventType : null;
  const screen = screenState({
    status: task.status,
    isAssignee,
    hasAssignee: task.assigneeUserId !== null && task.assigneeUserId !== undefined,
    runStatus: detail.runStatus,
    lastEventType: lastEvent,
  });
  const badge = modeBadge(detail.runMode);
  const blockers = completionBlockers(detail.completionPolicy, {
    result,
    checked,
    attachmentCount: detail.attachments.length,
  });
  const step = stepIndex(task.status);

  return (
    <main
      style={{ fontFamily: 'sans-serif', padding: '1rem', maxWidth: '480px', margin: '0 auto' }}
    >
      <button style={button(false)} onClick={() => setDetail(null)}>
        ← 목록
      </button>

      {/* REG-01 실제/훈련 배지 — 색상만으로 구분하지 않는다. */}
      <p style={{ fontWeight: 700, color: badge.tone === 'live' ? '#b91c1c' : '#7c3aed' }}>
        {badge.mark} {badge.text}
      </p>

      {/* REG-02 임무 카드 */}
      <h1 style={{ fontSize: '1.25rem' }}>{task.title}</h1>
      <p style={{ color: TONE_COLORS[screen.tone], fontWeight: 600 }}>{screen.label}</p>
      {task.dueAt && (
        <p style={{ fontSize: '0.9rem' }}>기한: {new Date(task.dueAt).toLocaleString('ko-KR')}</p>
      )}
      <ul>
        {(task.instructions ?? []).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      {/* REG-03 상태 Stepper */}
      <ol
        style={{
          display: 'flex',
          gap: '0.25rem',
          listStyle: 'none',
          padding: 0,
          fontSize: '0.75rem',
        }}
      >
        {FIELD_STEPS.map((s, i) => (
          <li
            key={s}
            style={{
              flex: 1,
              padding: '0.25rem',
              textAlign: 'center',
              borderRadius: '4px',
              background: step >= 0 && i <= step ? '#dbeafe' : '#f1f5f9',
              color: step >= 0 && i <= step ? '#1e3a8a' : '#94a3b8',
            }}
          >
            {s}
          </li>
        ))}
      </ol>

      <QueueBanner pending={pending} onFlush={() => void flush()} />
      {notice && <p style={{ color: '#15803d' }}>{notice}</p>}
      {failure && <pre style={{ whiteSpace: 'pre-wrap', color: '#b91c1c' }}>{failure}</pre>}

      {actions.includes('ACKNOWLEDGE') && (
        <button
          style={button(true)}
          disabled={busy}
          onClick={() =>
            void submit(
              task.taskId,
              `/tasks/${task.taskId}/acknowledge`,
              { receivedAt: new Date().toISOString() },
              'ACKNOWLEDGE',
            )
          }
        >
          {ACTION_LABELS.ACKNOWLEDGE}
        </button>
      )}

      {actions.includes('START') && (
        <button
          style={button(true)}
          disabled={busy}
          onClick={() =>
            void submit(
              task.taskId,
              `/tasks/${task.taskId}/start`,
              { startedAt: new Date().toISOString(), note: note || null },
              'START',
            )
          }
        >
          {ACTION_LABELS.START}
        </button>
      )}

      {actions.includes('REPORT_PROGRESS') && (
        <section style={{ marginTop: '1rem' }}>
          <h2 style={{ fontSize: '1rem' }}>진행보고</h2>
          <label htmlFor="progress">진행률 {progress}%</label>
          <input
            id="progress"
            type="range"
            min={0}
            max={100}
            value={progress}
            style={{ width: '100%', minHeight: '44px' }}
            onChange={(e) => setProgress(Number(e.target.value))}
          />
          <label htmlFor="note">메모</label>
          <textarea
            id="note"
            style={field}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            style={button(false)}
            disabled={busy}
            onClick={() =>
              void submit(
                task.taskId,
                `/tasks/${task.taskId}/progress`,
                { progress, note: note || null, attachmentIds: [] },
                'REPORT_PROGRESS',
              )
            }
          >
            {ACTION_LABELS.REPORT_PROGRESS}
          </button>
        </section>
      )}

      {actions.includes('SUBMIT_COMPLETION') && (
        <section style={{ marginTop: '1rem' }}>
          <h2 style={{ fontSize: '1rem' }}>완료 제출</h2>
          {detail.completionPolicy.checklist.map((item) => (
            <label key={item.key} style={{ display: 'block', minHeight: '44px' }}>
              <input
                type="checkbox"
                checked={checked.includes(item.key)}
                onChange={(e) =>
                  setChecked((prev) =>
                    e.target.checked ? [...prev, item.key] : prev.filter((k) => k !== item.key),
                  )
                }
              />{' '}
              {item.label}
              {item.requiresEvidence ? ' (증빙 필요)' : ''}
            </label>
          ))}
          <label htmlFor="result">완료 내용</label>
          <textarea
            id="result"
            style={field}
            value={result}
            onChange={(e) => setResult(e.target.value)}
          />
          {blockers.length > 0 && (
            <ul style={{ color: '#b45309', fontSize: '0.85rem' }}>
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          <button
            style={button(true)}
            disabled={busy || blockers.length > 0}
            onClick={() =>
              void submit(
                task.taskId,
                `/tasks/${task.taskId}/complete`,
                {
                  outcome: 'DONE',
                  completedAt: new Date().toISOString(),
                  result,
                  checklist: checked,
                },
                'SUBMIT_COMPLETION',
              )
            }
          >
            {ACTION_LABELS.SUBMIT_COMPLETION}
          </button>

          <button style={button(false)} onClick={() => setUnableOpen((v) => !v)}>
            {ACTION_LABELS.REPORT_UNABLE}
          </button>
          {unableOpen && (
            <div>
              <label htmlFor="unable">사유</label>
              <select
                id="unable"
                style={field}
                value={unableReason}
                onChange={(e) => setUnableReason(e.target.value)}
              >
                {UNABLE_REASONS.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </select>
              <button
                style={button(false)}
                disabled={busy || result.trim().length === 0}
                onClick={() =>
                  void submit(
                    task.taskId,
                    `/tasks/${task.taskId}/complete`,
                    { outcome: 'UNABLE', result, unableReasonCode: unableReason },
                    'REPORT_UNABLE',
                  )
                }
              >
                수행불가로 보고
              </button>
            </div>
          )}
        </section>
      )}

      <section style={{ marginTop: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem' }}>기록</h2>
        <ul style={{ fontSize: '0.85rem', color: '#475569' }}>
          {detail.events.map((e) => (
            <li key={e.taskEventId}>
              {new Date(e.eventTime).toLocaleString('ko-KR')} · {e.eventType}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function QueueBanner({
  pending,
  onFlush,
}: {
  pending: QueuedAction[];
  onFlush: () => void;
}): JSX.Element | null {
  if (pending.length === 0) return null;
  return (
    <div
      style={{
        background: '#fef3c7',
        border: '1px solid #fcd34d',
        borderRadius: '8px',
        padding: '0.75rem',
        margin: '0.75rem 0',
      }}
    >
      <strong>보내지 못한 보고 {pending.length}건</strong>
      <ul style={{ fontSize: '0.85rem', margin: '0.25rem 0 0', paddingLeft: '1rem' }}>
        {pending.map((a) => (
          <li key={a.id}>
            {a.label} · {new Date(a.queuedAt).toLocaleString('ko-KR')}
          </li>
        ))}
      </ul>
      <button style={button(false)} onClick={onFlush}>
        지금 다시 보내기
      </button>
    </div>
  );
}
