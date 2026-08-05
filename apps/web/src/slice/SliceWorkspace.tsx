import { useCallback, useMemo, useReducer, useRef, useState, type JSX } from 'react';
import { ApiClient } from '../api/client';
import { ApiCallError } from '../api/errors';
import { SliceApi, sha256Hex } from '../api/slice';
import { apiBaseUrl } from '../config';
import { buildMockExternalToken } from './mock-sso';
import {
  STEPS,
  blockedReason,
  initialState,
  isJobOpen,
  reducer,
  type SliceState,
  type StepKey,
} from './state';
import {
  Button,
  Facts,
  Field,
  FailureBox,
  Mono,
  Note,
  Panel,
  StatusChip,
  colors,
  inputStyle,
} from './ui';

/**
 * Plan 수직 슬라이스 워크스페이스 (CC-170).
 *
 * SSO mock 로그인부터 HWPX 다운로드까지 여섯 화면이다. 각 화면은 자기가 호출한
 * API ID와 서버가 돌려준 식별자를 그대로 보여 준다 — 이 화면의 캡처가 E2E 증거의
 * "화면 캡처" 항목이 되므로, 화면에 보이는 값과 DB의 값이 대조 가능해야 한다.
 *
 * **편집기 화면은 없다.** rhwp가 반입되지 않았다(OB-12). 반입된 문서의 본문을
 * 사람이 손으로 고치는 화면은 그 항목에서 생긴다.
 */

const POLL_INTERVAL_MS = 700;
const POLL_TIMEOUT_MS = 60_000;

export function SliceWorkspace(): JSX.Element {
  const clientRef = useRef<ApiClient>(new ApiClient(apiBaseUrl()));
  const apiRef = useRef<SliceApi>(new SliceApi(clientRef.current));
  const [state, dispatch] = useReducer(reducer, initialState);

  /**
   * 모든 호출을 한 곳으로 모은다. busy·오류·로그·상관관계 ID를 화면마다 다시
   * 쓰면 어딘가는 반드시 빠뜨린다.
   */
  const run = useCallback(
    async <T,>(label: string, fn: () => Promise<T>, detail?: (value: T) => string) => {
      dispatch({ type: 'BUSY', busy: true });
      dispatch({ type: 'FAIL', failure: null });
      const correlationId = clientRef.current.correlationId();
      dispatch({ type: 'TRACE', correlationId });
      try {
        const value = await fn();
        dispatch({
          type: 'LOG',
          entry: {
            at: new Date().toISOString(),
            label,
            detail: detail?.(value),
            correlationId,
            ok: true,
          },
        });
        dispatch({ type: 'BUSY', busy: false });
        return value;
      } catch (error) {
        const failure =
          error instanceof ApiCallError
            ? error.failure
            : {
                status: 0,
                code: 'CLIENT-0000',
                message: (error as Error).message,
                recoverable: false,
                correlationId,
              };
        dispatch({ type: 'FAIL', failure });
        dispatch({
          type: 'LOG',
          entry: {
            at: new Date().toISOString(),
            label,
            detail: `${failure.code} ${failure.message}`,
            correlationId,
            ok: false,
          },
        });
        return undefined;
      }
    },
    [],
  );

  const step = state.step;
  const blocked = blockedReason(state, step);

  return (
    <main
      style={{
        fontFamily: 'system-ui, -apple-system, "Malgun Gothic", sans-serif',
        color: '#1f2933',
        maxWidth: 1040,
        margin: '0 auto',
        padding: '1.5rem',
      }}
    >
      <header style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.35rem', margin: 0 }}>
          UNE 재난문서 플랫폼 — 계획서 수직 슬라이스
        </h1>
        <p style={{ color: colors.muted, fontSize: '0.85rem', margin: '0.3rem 0 0' }}>
          API <Mono>{apiBaseUrl()}</Mono>
          {state.correlationId ? (
            <>
              {' · '}Correlation ID <Mono data-testid="correlation-id">{state.correlationId}</Mono>
            </>
          ) : null}
        </p>
      </header>

      <nav style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1rem' }}>
        {STEPS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => dispatch({ type: 'STEP', step: s.key })}
            data-testid={`step-${s.key}`}
            style={{
              padding: '0.4rem 0.7rem',
              borderRadius: 999,
              border: `1px solid ${s.key === step ? '#1f4e8c' : colors.border}`,
              background: s.key === step ? '#1f4e8c' : '#fff',
              color: s.key === step ? '#fff' : colors.muted,
              fontSize: '0.82rem',
              cursor: 'pointer',
            }}
          >
            {s.title}
          </button>
        ))}
      </nav>

      {state.failure ? <FailureBox failure={state.failure} /> : null}
      {blocked ? <Note>{blocked}</Note> : null}
      {state.busy ? <Note>요청을 처리하고 있습니다…</Note> : null}

      {step === 'login' ? (
        <LoginStep state={state} api={apiRef.current} run={run} dispatch={dispatch} />
      ) : null}
      {step === 'plan' ? (
        <PlanStep state={state} api={apiRef.current} run={run} dispatch={dispatch} />
      ) : null}
      {step === 'context' ? (
        <ContextStep state={state} api={apiRef.current} run={run} dispatch={dispatch} />
      ) : null}
      {step === 'upload' ? (
        <UploadStep
          state={state}
          api={apiRef.current}
          client={clientRef.current}
          run={run}
          dispatch={dispatch}
        />
      ) : null}
      {step === 'generate' ? (
        <GenerateStep state={state} api={apiRef.current} run={run} dispatch={dispatch} />
      ) : null}
      {step === 'export' ? (
        <ExportStep state={state} api={apiRef.current} run={run} dispatch={dispatch} />
      ) : null}

      <ActivityLog state={state} />
    </main>
  );
}

type Dispatch = React.Dispatch<import('./state').SliceAction>;
type Run = <T>(
  label: string,
  fn: () => Promise<T>,
  detail?: (value: T) => string,
) => Promise<T | undefined>;

interface StepProps {
  state: SliceState;
  api: SliceApi;
  run: Run;
  dispatch: Dispatch;
}

function nextStep(current: StepKey): StepKey {
  const index = STEPS.findIndex((s) => s.key === current);
  return STEPS[Math.min(index + 1, STEPS.length - 1)].key;
}

// ── 1. 로그인 ────────────────────────────────────────────────────────────

function LoginStep({ state, api, run, dispatch }: StepProps): JSX.Element {
  const [tenantId, setTenantId] = useState('');
  const [loginId, setLoginId] = useState('');

  const login = async (): Promise<void> => {
    const ok = await run('UNE-AUTH-001 SSO 교환', async () => {
      await api.exchange(
        buildMockExternalToken({ tenantId: tenantId.trim(), loginId: loginId.trim() }),
      );
      return api.me();
    });
    if (ok) {
      dispatch({ type: 'USER', user: ok });
      dispatch({ type: 'STEP', step: 'plan' });
    }
  };

  return (
    <Panel
      title="1. 로그인 (UNE-AUTH-001/002)"
      footnote="AUTH_MODE=mock 경로다. 외부 토큰은 자격증명이 아니라 기관·로그인 ID 주장이며, 실제 존재 여부는 서버가 판단한다(ADR-22 D3). 실제 T3Q SSO는 OB-01이 열릴 때 이 화면을 대체한다."
    >
      {state.user ? (
        <Facts
          rows={[
            ['사용자', <Mono key="u">{state.user.displayName ?? state.user.userId}</Mono>],
            ['기관', <Mono key="t">{state.user.tenantName ?? state.user.tenantId}</Mono>],
            ['역할', (state.user.roles ?? []).map((r) => r.roleCode).join(', ') || '(없음)'],
            ['권한 수', String((state.user.permissions ?? []).length)],
          ]}
        />
      ) : (
        <>
          <Field label="기관 ID (tenantId, UUID)">
            <input
              style={inputStyle}
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              data-testid="tenant-id"
              placeholder="00000000-0000-4000-8000-000000000001"
            />
          </Field>
          <Field label="로그인 ID">
            <input
              style={inputStyle}
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              data-testid="login-id"
              placeholder="admin-a"
            />
          </Field>
          <Button onClick={login} disabled={state.busy || !tenantId || !loginId} testId="login">
            로그인
          </Button>
        </>
      )}
    </Panel>
  );
}

// ── 2. 계획서 ────────────────────────────────────────────────────────────

function PlanStep({ state, api, run, dispatch }: StepProps): JSX.Element {
  const [title, setTitle] = useState('2026 폭염 대응 계획서');

  const create = async (): Promise<void> => {
    const plan = await run('UNE-PLAN-001 계획서 생성', () =>
      api.createPlan({
        title: title.trim(),
        hazardType: '폭염',
        managementPhase: '대비',
        startMode: 'UPLOAD_HWPX',
      }),
    );
    if (plan) {
      dispatch({ type: 'PLAN', plan });
      dispatch({ type: 'STEP', step: nextStep('plan') });
    }
  };

  const list = async (): Promise<void> => {
    const page = await run('UNE-PLAN-002 계획서 목록', () => api.listPlans());
    if (page) dispatch({ type: 'PLANS', plans: page.items });
  };

  return (
    <Panel
      title="2. 계획서 (UNE-PLAN-001/002)"
      footnote="startMode=UPLOAD_HWPX는 '양식을 올려 시작한다'는 뜻이다. 양식 파일 자체는 4단계에서 반입한다."
    >
      {state.plan ? (
        <Facts
          rows={[
            ['planId', <Mono key="p">{state.plan.planId}</Mono>],
            ['제목', state.plan.title],
            ['상태', <StatusChip key="s" value={state.plan.status} />],
            ['버전', String(state.plan.versionNo)],
            [
              '문서',
              state.plan.documentId ? <Mono key="d">{state.plan.documentId}</Mono> : '(아직 없음)',
            ],
          ]}
        />
      ) : (
        <Field label="계획서 제목">
          <input
            style={inputStyle}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            data-testid="plan-title"
          />
        </Field>
      )}
      <div style={{ marginTop: '0.75rem' }}>
        <Button onClick={create} disabled={state.busy || !state.user} testId="create-plan">
          계획서 만들기
        </Button>
        <Button
          onClick={list}
          kind="ghost"
          disabled={state.busy || !state.user}
          testId="list-plans"
        >
          목록 새로고침
        </Button>
      </div>
      {state.plans.length > 0 ? (
        <ul style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
          {state.plans.map((plan) => (
            <li key={plan.planId} style={{ marginBottom: '0.25rem' }}>
              <button
                type="button"
                onClick={() => dispatch({ type: 'PLAN', plan })}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#1f4e8c',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                {plan.title}
              </button>{' '}
              <StatusChip value={plan.status} />
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

// ── 3. 기준정보 ──────────────────────────────────────────────────────────

const DEFAULT_CONTEXT = {
  subject: '2026년 폭염 대응 계획',
  organization: '재난안전본부',
  targetPeriod: { from: '2026-06-01', to: '2026-09-30' },
  hazardType: '폭염',
  scope: '관내 전역',
};

function ContextStep({ state, api, run, dispatch }: StepProps): JSX.Element {
  const [text, setText] = useState(JSON.stringify(DEFAULT_CONTEXT, null, 2));

  const parsed = useMemo<Record<string, unknown> | null>(() => {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
  }, [text]);

  const saveDraft = async (): Promise<void> => {
    if (!state.plan || !parsed) return;
    await run('UNE-PLAN-006 기준정보 임시저장', () =>
      api.saveContextDraft(state.plan!.planId, parsed),
    );
  };

  const confirm = async (): Promise<void> => {
    if (!state.plan || !parsed) return;
    const snapshot = await run('UNE-PLAN-007 Snapshot 확정', () =>
      api.confirmSnapshot(state.plan!.planId, parsed),
    );
    if (snapshot) {
      dispatch({ type: 'SNAPSHOT', contextSnapshotId: snapshot.contextSnapshotId });
      dispatch({ type: 'STEP', step: nextStep('context') });
    }
  };

  return (
    <Panel
      title="3. 기준정보 Snapshot (UNE-PLAN-006/007)"
      footnote="임시저장은 완화 검증, 확정은 엄격 검증이다. 확정된 Snapshot은 불변이며 목차·본문 생성의 입력이 된다."
    >
      <Field label="기준정보 (JSON)">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          data-testid="context-json"
          style={{
            ...inputStyle,
            maxWidth: '100%',
            fontFamily: 'ui-monospace, Consolas, monospace',
          }}
        />
      </Field>
      {parsed === null ? <Note>JSON 형식이 아닙니다.</Note> : null}
      <Button onClick={saveDraft} kind="ghost" disabled={state.busy || !state.plan || !parsed}>
        임시저장
      </Button>
      <Button
        onClick={confirm}
        disabled={state.busy || !state.plan || !parsed}
        testId="confirm-snapshot"
      >
        Snapshot 확정
      </Button>
      {state.contextSnapshotId ? (
        <div style={{ marginTop: '0.75rem' }}>
          <Facts rows={[['contextSnapshotId', <Mono key="s">{state.contextSnapshotId}</Mono>]]} />
        </div>
      ) : null}
    </Panel>
  );
}

// ── 4. HWPX 반입 ─────────────────────────────────────────────────────────

function UploadStep({
  state,
  api,
  client,
  run,
  dispatch,
}: StepProps & { client: ApiClient }): JSX.Element {
  const [file, setFile] = useState<File | null>(null);

  /**
   * 3단을 한 번에 태운다: 사전등록 → 전송 → 완료확정 → 반입 → 분석 조회.
   *
   * 해시는 브라우저가 계산해 **선언**하고, 서버는 저장된 바이트에서 다시
   * 계산해 대조한다. 그래서 전송 중 손상이 조용히 통과하지 않는다.
   */
  const upload = async (): Promise<void> => {
    if (!file || !state.plan) return;
    const buffer = await file.arrayBuffer();
    const sha256 = await sha256Hex(buffer);

    const registration = await run(
      'UNE-DOC-001 사전등록',
      () =>
        api.registerFile({
          fileName: file.name,
          sizeBytes: file.size,
          mimeType: 'application/hwp+zip',
          sha256,
        }),
      (r) => `${r.file.fileId} (${r.upload.driver})`,
    );
    if (!registration) return;
    dispatch({
      type: 'FILE',
      fileId: registration.file.fileId,
      fileState: registration.file.uploadState,
      uploadDriver: registration.upload.driver,
    });

    const sent = await run('업로드 전송 (티켓)', async () => {
      await client.uploadBytes(
        {
          url: registration.upload.url,
          method: registration.upload.method,
          headers: registration.upload.headers as Record<string, string>,
        },
        new Uint8Array(buffer),
      );
      return true;
    });
    if (!sent) return;

    const verified = await run(
      'UNE-DOC-002 완료확정',
      () => api.completeFile(registration.file.fileId),
      (f) => f.uploadState,
    );
    if (!verified) return;
    dispatch({ type: 'FILE', fileId: verified.fileId, fileState: verified.uploadState });

    const document = await run(
      'UNE-DOC-003 반입',
      () =>
        api.importHwpx({
          fileId: registration.file.fileId,
          planId: state.plan!.planId,
          title: state.plan!.title,
        }),
      (d) => `${d.documentId} verdict=${d.analysis.verdict}`,
    );
    if (!document) return;
    dispatch({ type: 'DOCUMENT', document });

    const analysis = await run('UNE-DOC-004 분석 조회', () => api.analysis(document.documentId));
    if (analysis) dispatch({ type: 'ANALYSIS', analysis });
  };

  const counts = state.document?.analysis.objectCounts;

  return (
    <Panel
      title="4. HWPX 반입 (UNE-DOC-001~004)"
      footnote="사전등록 → 직접 전송 → 완료확정의 3단이다. 서버는 저장된 바이트에서 SHA-256을 다시 계산하고 ZIP·mimetype 구조로 HWPX인지 판정한다 — 확장자와 Content-Type은 근거가 아니다."
    >
      <Field label="HWPX 파일">
        <input
          type="file"
          accept=".hwpx"
          data-testid="hwpx-file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </Field>
      <Button onClick={upload} disabled={state.busy || !file || !state.plan} testId="upload-hwpx">
        업로드하고 반입
      </Button>

      {state.fileId ? (
        <div style={{ marginTop: '1rem' }}>
          <Facts
            rows={[
              ['fileId', <Mono key="f">{state.fileId}</Mono>],
              ['업로드 상태', <StatusChip key="s" value={state.fileState ?? '-'} />],
              ['전송 방식', state.uploadDriver ?? '-'],
            ]}
          />
        </div>
      ) : null}

      {state.document ? (
        <div style={{ marginTop: '1rem' }}>
          <Facts
            rows={[
              ['documentId', <Mono key="d">{state.document.documentId}</Mono>],
              ['revision', `#${state.document.revisionNo}`],
              ['분석 판정', <StatusChip key="v" value={state.document.analysis.verdict} />],
              ['신뢰도', state.document.analysis.confidence.toFixed(2)],
              [
                '객체 등급',
                counts
                  ? `편집가능 ${counts.NATIVE_EDIT} · 보존 ${counts.PRESERVE_ONLY} · 평면화 ${counts.FLATTEN_EXPORT_ONLY} · 거부 ${counts.REJECT}`
                  : '-',
              ],
              ['프로토타입', String(state.document.analysis.prototypeCount)],
              [
                '분석 해시',
                <Mono key="h">{state.document.analysis.analysisHash.slice(0, 16)}…</Mono>,
              ],
            ]}
          />
          {state.document.analysis.warnings.length > 0 ? (
            <ul style={{ fontSize: '0.85rem', color: colors.warn, marginTop: '0.5rem' }}>
              {state.document.analysis.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          <Button onClick={() => dispatch({ type: 'STEP', step: 'generate' })} kind="ghost">
            다음: 목차·본문 생성
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}

// ── 5. 목차·본문 생성 ────────────────────────────────────────────────────

function GenerateStep({ state, api, run, dispatch }: StepProps): JSX.Element {
  /**
   * Job 진행은 폴링으로 본다. 계약에는 SSE(UNE-PLAN-011)도 있지만 이 화면의
   * 목적은 "진행이 보인다"이고, 폴링은 재연결·Last-Event-ID 상태 없이 같은
   * 사실을 보여 준다. SSE 화면은 대시보드 항목에서 제 값을 한다.
   */
  const poll = useCallback(
    async (jobId: string, onUpdate: (job: import('../api/slice').GenerationJob) => void) => {
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      for (;;) {
        const job = await api.job(jobId);
        onUpdate(job);
        if (!isJobOpen(job)) return job;
        if (Date.now() > deadline) return job;
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    },
    [api],
  );

  const generateToc = async (): Promise<void> => {
    if (!state.plan || !state.contextSnapshotId) return;
    const started = await run('UNE-PLAN-009 목차 생성 요청', () =>
      api.startTocJob(state.plan!.planId, state.contextSnapshotId!),
    );
    if (!started) return;
    dispatch({ type: 'TOC_JOB', job: started });
    const done = await run('UNE-PLAN-010 목차 Job 폴링', () =>
      poll(started.jobId, (job) => dispatch({ type: 'TOC_JOB', job })),
    );
    const tocVersionId = (done?.result as { tocVersionId?: string } | null)?.tocVersionId;
    if (tocVersionId) dispatch({ type: 'TOC_VERSION', tocVersionId });
  };

  const confirmToc = async (): Promise<void> => {
    if (!state.plan || !state.tocVersionId) return;
    const version = await run('UNE-PLAN-014 목차 확정', () =>
      api.confirmToc(state.plan!.planId, state.tocVersionId!),
    );
    if (version) dispatch({ type: 'TOC_VERSION', tocVersionId: version.tocVersionId });
  };

  const generateContent = async (): Promise<void> => {
    if (!state.plan || !state.contextSnapshotId || !state.tocVersionId) return;
    const started = await run('UNE-PLAN-016 본문 생성 요청', () =>
      api.startContentJob(state.plan!.planId, {
        contextSnapshotId: state.contextSnapshotId!,
        tocVersionId: state.tocVersionId!,
      }),
    );
    if (!started) return;
    dispatch({ type: 'CONTENT_JOB', job: started });
    await run('본문 Job 폴링', () =>
      poll(started.jobId, (job) => dispatch({ type: 'CONTENT_JOB', job })),
    );
  };

  const cancel = async (job: import('../api/slice').GenerationJob | null): Promise<void> => {
    if (!job) return;
    const cancelled = await run('UNE-PLAN-012 생성 중지', () => api.cancelJob(job.jobId));
    if (cancelled) {
      dispatch({ type: job.jobType === 'TOC' ? 'TOC_JOB' : 'CONTENT_JOB', job: cancelled });
    }
  };

  return (
    <>
      <Panel
        title="5-1. 목차 생성 (UNE-PLAN-009/010)"
        footnote="T3Q RPT-001을 어댑터 뒤에서 호출한다. UNE 서비스는 LLM을 직접 부르지 않는다."
      >
        <Button
          onClick={generateToc}
          disabled={state.busy || !state.contextSnapshotId}
          testId="generate-toc"
        >
          목차 생성
        </Button>
        <Button
          onClick={() => cancel(state.tocJob)}
          kind="ghost"
          disabled={!isJobOpen(state.tocJob)}
        >
          중지
        </Button>
        {state.tocJob ? <JobFacts job={state.tocJob} /> : null}
        {state.tocVersionId ? (
          <div style={{ marginTop: '0.5rem' }}>
            <Facts rows={[['tocVersionId', <Mono key="t">{state.tocVersionId}</Mono>]]} />
            <Button onClick={confirmToc} kind="ghost" disabled={state.busy} testId="confirm-toc">
              목차 확정
            </Button>
          </div>
        ) : null}
      </Panel>

      <Panel
        title="5-2. 본문 생성 (UNE-PLAN-016)"
        footnote="확정된 목차 위에서 T3Q RPT-002를 호출한다. 사용자가 고친 블록은 재생성에서 보호된다."
      >
        <Button
          onClick={generateContent}
          disabled={state.busy || !state.tocVersionId}
          testId="generate-content"
        >
          본문 생성
        </Button>
        <Button
          onClick={() => cancel(state.contentJob)}
          kind="ghost"
          disabled={!isJobOpen(state.contentJob)}
        >
          중지
        </Button>
        {state.contentJob ? <JobFacts job={state.contentJob} /> : null}
        {state.contentJob?.status === 'COMPLETED' ? (
          <Button onClick={() => dispatch({ type: 'STEP', step: 'export' })} kind="ghost">
            다음: Export
          </Button>
        ) : null}
      </Panel>
    </>
  );
}

function JobFacts({ job }: { job: import('../api/slice').GenerationJob }): JSX.Element {
  return (
    <div style={{ marginTop: '0.75rem' }} data-testid={`job-${job.jobType}`}>
      <Facts
        rows={[
          ['jobId', <Mono key="j">{job.jobId}</Mono>],
          ['상태', <StatusChip key="s" value={job.status} />],
          ['진행', `${job.progressPct ?? 0}%`],
          ['시도', String(job.attemptNo ?? 0)],
          ...(job.error
            ? ([['오류', `${job.error.code ?? ''} ${job.error.message ?? ''}`]] as [
                string,
                string,
              ][])
            : []),
        ]}
      />
    </div>
  );
}

// ── 6. Export·다운로드 ───────────────────────────────────────────────────

function ExportStep({ state, api, run, dispatch }: StepProps): JSX.Element {
  const requestExport = async (): Promise<void> => {
    if (!state.document) return;
    const job = await run('UNE-DOC-012 Export 요청', () =>
      api.requestExport(state.document!.documentId),
    );
    if (!job) return;
    dispatch({ type: 'EXPORT', job });

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    await run('UNE-DOC-013 Export 상태 폴링', async () => {
      for (;;) {
        const current = await api.exportStatus(job.exportId);
        dispatch({ type: 'EXPORT', job: current });
        if (current.status === 'COMPLETED' || current.status === 'FAILED') return current;
        if (Date.now() > deadline) return current;
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    });
  };

  const download = async (): Promise<void> => {
    if (!state.exportJob) return;
    const result = await run('UNE-DOC-014 다운로드', () => api.download(state.exportJob!.exportId));
    if (!result) return;
    dispatch({
      type: 'DOWNLOADED',
      downloaded: { fileName: result.fileName, sizeBytes: result.blob.size, sha256: result.sha256 },
    });
    const url = URL.createObjectURL(result.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = result.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const validation = state.exportJob?.validation ?? null;

  return (
    <Panel
      title="6. Export·다운로드 (UNE-DOC-012~014)"
      footnote="되쓰기와 Track A 검증은 워커가 한다. 검증이 FAIL이면 산출물 바이트는 폐기되고 다운로드는 열리지 않는다(ADR-31 D6)."
    >
      <Button
        onClick={requestExport}
        disabled={state.busy || !state.document}
        testId="request-export"
      >
        HWPX Export 요청
      </Button>
      <Button
        onClick={download}
        kind="ghost"
        disabled={state.busy || state.exportJob?.status !== 'COMPLETED'}
        testId="download-export"
      >
        다운로드
      </Button>

      {state.exportJob ? (
        <div style={{ marginTop: '1rem' }}>
          <Facts
            rows={[
              ['exportId', <Mono key="e">{state.exportJob.exportId}</Mono>],
              ['형식', state.exportJob.format],
              ['상태', <StatusChip key="s" value={state.exportJob.status} />],
              [
                '산출 파일',
                state.exportJob.outputFileId ? (
                  <Mono key="o">{state.exportJob.outputFileId}</Mono>
                ) : (
                  '(아직 없음)'
                ),
              ],
            ]}
          />
        </div>
      ) : null}

      {validation ? (
        <div style={{ marginTop: '1rem' }} data-testid="validation-report">
          <h3 style={{ fontSize: '0.9rem', margin: '0 0 0.5rem' }}>
            Track A 검증 <StatusChip value={validation.status} />
          </h3>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', width: '100%' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: colors.muted }}>
                <th style={{ padding: '0.2rem 0.5rem 0.2rem 0' }}>검사</th>
                <th style={{ padding: '0.2rem 0.5rem 0.2rem 0' }}>계층</th>
                <th style={{ padding: '0.2rem 0.5rem 0.2rem 0' }}>결과</th>
                <th style={{ padding: '0.2rem 0' }}>내용</th>
              </tr>
            </thead>
            <tbody>
              {validation.checks.map((check) => (
                <tr key={`${check.code}-${check.detail}`}>
                  <td style={{ padding: '0.2rem 0.5rem 0.2rem 0' }}>
                    <Mono>{check.code}</Mono>
                  </td>
                  <td style={{ padding: '0.2rem 0.5rem 0.2rem 0' }}>{check.layer ?? '-'}</td>
                  <td style={{ padding: '0.2rem 0.5rem 0.2rem 0' }}>{check.outcome}</td>
                  <td style={{ padding: '0.2rem 0' }}>{check.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4 style={{ fontSize: '0.85rem', margin: '0.75rem 0 0.25rem' }}>실행하지 않은 계층</h4>
          <ul style={{ fontSize: '0.8rem', margin: 0, paddingLeft: '1.2rem', color: colors.muted }}>
            {validation.notRunLayers.map((layer) => (
              <li key={layer.layer}>
                <strong>{layer.layer}</strong> — {layer.reason}
              </li>
            ))}
          </ul>
          {validation.outputSha256 ? (
            <p style={{ fontSize: '0.8rem', color: colors.muted, marginTop: '0.5rem' }}>
              산출물 SHA-256 <Mono>{validation.outputSha256.slice(0, 24)}…</Mono>
              {validation.sourceSha256 === validation.outputSha256
                ? ' (원본과 바이트 동일)'
                : ' (원본과 다름 — 편집이 반영됐다)'}
            </p>
          ) : null}
        </div>
      ) : null}

      {state.downloaded ? (
        <div style={{ marginTop: '1rem' }} data-testid="downloaded">
          <Facts
            rows={[
              ['받은 파일', state.downloaded.fileName],
              ['크기', `${state.downloaded.sizeBytes.toLocaleString()} 바이트`],
              ['SHA-256', <Mono key="h">{state.downloaded.sha256.slice(0, 24)}…</Mono>],
            ]}
          />
          <Note>
            한/글에서 열리는지는 이 화면이 답하지 못한다 — Track B는 릴리스 게이트이며 환경이
            확정되지 않았다(OB-08, CC-420).
          </Note>
        </div>
      ) : null}
    </Panel>
  );
}

// ── 활동 로그 ────────────────────────────────────────────────────────────

function ActivityLog({ state }: { state: SliceState }): JSX.Element | null {
  if (state.log.length === 0) return null;
  return (
    <Panel
      title="호출 기록"
      footnote="화면 캡처가 곧 증거가 되도록 호출 순서와 상관관계 ID를 남긴다."
    >
      <ol
        style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.8rem' }}
        data-testid="activity-log"
      >
        {state.log.map((entry) => (
          <li key={`${entry.at}-${entry.label}`} style={{ marginBottom: '0.2rem' }}>
            <span style={{ color: entry.ok ? colors.ok : colors.bad }}>
              {entry.ok ? '성공' : '실패'}
            </span>{' '}
            {entry.label}
            {entry.detail ? <span style={{ color: colors.muted }}> — {entry.detail}</span> : null}
          </li>
        ))}
      </ol>
    </Panel>
  );
}
