import { useCallback, useMemo, useState, type JSX } from 'react';
import type { ApiClient } from '../api/client';
import { ApiCallError, describeFailure, nextActionFor } from '../api/errors';
import {
  EvaluationApi,
  type ClosurePreview,
  type Evaluation,
  type EvaluationReport,
} from './evaluation-api';
import {
  EVALUATION_STATUS_LABELS,
  closeReadiness,
  evaluationActions,
  groupBlockers,
  metricsNotice,
} from './evaluation-state';

/**
 * 훈련 종료·평가 화면 (CC-310, 설계 09 SCR-EVAL-001~004).
 *
 * 네 단계를 세로로 놓는다: 종료 게이트 → 평가 작성 → 개선조치 → 보고서.
 * 화면을 쪼개면 사람이 "무엇을 근거로 이 점수를 매겼는지"를 화면 사이에서 잃는다.
 *
 * **미결마다 사유 칸이 있다.** 사유 없이 닫는 버튼이 눌리지 않아야 하고, 왜
 * 눌리지 않는지가 화면에 적혀 있어야 한다.
 */

const panel: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  padding: '0.9rem',
  background: '#ffffff',
  marginBottom: '0.9rem',
};

const input: React.CSSProperties = {
  width: '100%',
  padding: '0.4rem 0.5rem',
  border: '1px solid #cbd5e1',
  borderRadius: '6px',
  fontSize: '0.9rem',
};

function Banner({
  tone,
  children,
}: {
  tone: 'warn' | 'bad' | 'info' | 'good';
  children: React.ReactNode;
}): JSX.Element {
  const colors = {
    warn: { bg: '#fffbeb', border: '#fcd34d', fg: '#92400e' },
    bad: { bg: '#fef2f2', border: '#fca5a5', fg: '#991b1b' },
    info: { bg: '#eff6ff', border: '#bfdbfe', fg: '#1e40af' },
    good: { bg: '#f0fdf4', border: '#86efac', fg: '#166534' },
  }[tone];
  return (
    <p
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        color: colors.fg,
        borderRadius: '6px',
        padding: '0.5rem 0.7rem',
        fontSize: '0.85rem',
        whiteSpace: 'pre-wrap',
      }}
    >
      {children}
    </p>
  );
}

export function EvaluationScreen({
  client,
  situationId,
}: {
  client: ApiClient;
  situationId: string;
}): JSX.Element {
  const api = useMemo(() => new EvaluationApi(client), [client]);

  const [preview, setPreview] = useState<ClosurePreview | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [closed, setClosed] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 종료는 되돌릴 수 없다 — 한 번 더 묻는다(frontend.md). */
  const [confirmingClose, setConfirmingClose] = useState(false);

  const [summary, setSummary] = useState('');
  const [criterion, setCriterion] = useState('DISPATCH_TIME');
  const [scoreValue, setScoreValue] = useState('80');
  const [weightValue, setWeightValue] = useState('1');
  const [evidence, setEvidence] = useState('');
  const [actionText, setActionText] = useState('');
  const [targetType, setTargetType] = useState<'' | 'PLAN' | 'SOP' | 'SYSTEM'>('');
  const [targetId, setTargetId] = useState('');

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setFailure(null);
    try {
      await fn();
    } catch (error) {
      if (error instanceof ApiCallError) {
        setFailure(
          [describeFailure(error.failure), nextActionFor(error.failure)].filter(Boolean).join('\n'),
        );
      } else setFailure(String(error));
    } finally {
      setBusy(false);
    }
  }, []);

  const readiness = closeReadiness(preview, reasons);
  const actions = evaluation ? evaluationActions(evaluation) : null;
  const staleNotice = evaluation ? metricsNotice(evaluation) : null;

  return (
    <main style={{ maxWidth: '960px', margin: '0 auto', padding: '1rem' }}>
      <h1 style={{ fontSize: '1.2rem', marginBottom: '0.6rem' }}>훈련 종료와 평가</h1>
      {failure && <Banner tone="bad">{failure}</Banner>}

      {/* ── 종료 게이트 (SCR-EVAL-001, UNE-JNL-012) ─────────────────────── */}
      <section style={panel}>
        <h2 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>1. 종료 게이트</h2>
        <button
          disabled={busy}
          onClick={() => void run(async () => setPreview(await api.closePreview(situationId)))}
          data-testid="close-preview"
        >
          미결 확인
        </button>

        {preview && (
          <div style={{ marginTop: '0.6rem' }}>
            <Banner tone={readiness.ready ? 'good' : 'warn'}>{readiness.message}</Banner>
            {groupBlockers(preview.blockers).map((group) => (
              <div key={group.kind} style={{ marginBottom: '0.6rem' }}>
                <strong style={{ fontSize: '0.85rem' }}>
                  {group.label} {group.items.length}건
                </strong>
                {group.items.map((item) => (
                  <div
                    key={item.refId}
                    style={{ display: 'grid', gap: '0.3rem', marginTop: '0.3rem' }}
                  >
                    <span style={{ fontSize: '0.8rem', color: '#475569' }}>
                      {item.label} — {item.detail}
                    </span>
                    <input
                      style={input}
                      placeholder="그대로 두고 닫는 사유 (필수)"
                      value={reasons[item.refId] ?? ''}
                      onChange={(e) => setReasons((r) => ({ ...r, [item.refId]: e.target.value }))}
                      data-testid={`reason-${item.refId}`}
                    />
                  </div>
                ))}
              </div>
            ))}
            <input
              style={input}
              placeholder="종료 요약"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
            {confirmingClose && (
              <Banner tone="bad">
                종료하면 기준선 해시가 굳고 <strong>되돌릴 수 없습니다</strong>. 이 훈련에는 새
                사실을 쓸 수 없게 되고 정정만 가능합니다. 그대로 진행하시겠습니까?
              </Banner>
            )}
            <button
              style={{ marginTop: '0.4rem' }}
              disabled={busy || !readiness.ready}
              onClick={() => {
                if (!confirmingClose) {
                  setConfirmingClose(true);
                  return;
                }
                void run(async () => {
                  const result = await api.close(situationId, {
                    resultSummary: summary || undefined,
                    dispositions: preview.blockers.map((b) => ({
                      refId: b.refId,
                      disposition: 'WAIVED' as const,
                      reason: reasons[b.refId] ?? '',
                    })),
                  });
                  setClosed(result.baselineHash);
                  setConfirmingClose(false);
                  setPreview(await api.closePreview(situationId));
                });
              }}
              data-testid="close"
            >
              {confirmingClose ? '확인: 되돌릴 수 없습니다 — 종료' : '훈련 종료'}
            </button>
            {closed && (
              <Banner tone="good">
                종료했습니다. 기준선 해시 {closed.slice(0, 12)}… — 이 뒤로 이 훈련에는 새 사실을 쓸
                수 없고 정정만 가능합니다.
              </Banner>
            )}
          </div>
        )}
      </section>

      {/* ── 평가 (SCR-EVAL-002, UNE-JNL-013) ────────────────────────────── */}
      <section style={panel}>
        <h2 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>2. 평가</h2>
        <p style={{ fontSize: '0.8rem', color: '#64748b' }}>
          종료된 훈련만 평가할 수 있습니다. 근거로 다는 이벤트는 이 훈련의 사실원장에 있어야 합니다.
        </p>
        <div style={{ display: 'grid', gap: '0.4rem', gridTemplateColumns: '2fr 1fr 1fr 2fr' }}>
          <input
            style={input}
            placeholder="지표 코드"
            value={criterion}
            onChange={(e) => setCriterion(e.target.value)}
            data-testid="criterion"
          />
          <input
            style={input}
            placeholder="점수"
            value={scoreValue}
            onChange={(e) => setScoreValue(e.target.value)}
          />
          <input
            style={input}
            placeholder="가중치"
            value={weightValue}
            onChange={(e) => setWeightValue(e.target.value)}
          />
          <input
            style={input}
            placeholder="근거 이벤트 ID (쉼표)"
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
          />
        </div>
        <button
          style={{ marginTop: '0.4rem' }}
          disabled={busy || !criterion}
          onClick={() =>
            void run(async () =>
              setEvaluation(
                await api.createEvaluation(situationId, {
                  summary: summary || undefined,
                  scores: [
                    {
                      criterionCode: criterion,
                      scoreValue: Number(scoreValue),
                      weightValue: Number(weightValue),
                      evidenceEventIds: evidence
                        .split(',')
                        .map((v) => v.trim())
                        .filter(Boolean),
                    },
                  ],
                }),
              ),
            )
          }
          data-testid="create-evaluation"
        >
          평가 만들기
        </button>

        {evaluation && actions && (
          <div style={{ marginTop: '0.6rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>
                {EVALUATION_STATUS_LABELS[evaluation.status] ?? evaluation.status} · 종합{' '}
                {evaluation.overallScore ?? 'N/A'}
              </strong>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                {evaluation.evaluationId.slice(0, 8)}…
              </span>
            </div>
            {/* 낡은 지표를 다시 계산해 보여 주지 않는다 — 확정된 값과 갈라진다. */}
            {staleNotice && <Banner tone="warn">{staleNotice}</Banner>}
            {actions.frozenReason && <Banner tone="info">{actions.frozenReason}</Banner>}
            <pre
              style={{
                fontSize: '0.75rem',
                background: '#f8fafc',
                padding: '0.5rem',
                overflowX: 'auto',
              }}
            >
              {JSON.stringify(evaluation.metrics, null, 2)}
            </pre>
          </div>
        )}
      </section>

      {/* ── 개선조치 (SCR-EVAL-003, UNE-JNL-014) ────────────────────────── */}
      {evaluation && actions && (
        <section style={panel}>
          <h2 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>3. 개선조치 환류</h2>
          <p style={{ fontSize: '0.8rem', color: '#64748b' }}>
            개선조치는 SOP·계획서를 <strong>가리키기만 합니다</strong>. 대상 문서를 자동으로 바꾸지
            않습니다.
          </p>
          <div style={{ display: 'grid', gap: '0.4rem', gridTemplateColumns: '3fr 1fr 2fr' }}>
            <input
              style={input}
              placeholder="조치 내용"
              value={actionText}
              onChange={(e) => setActionText(e.target.value)}
              data-testid="action-text"
            />
            <select
              style={input}
              value={targetType}
              onChange={(e) => setTargetType(e.target.value as typeof targetType)}
            >
              <option value="">대상 없음</option>
              <option value="SOP">SOP</option>
              <option value="PLAN">계획서</option>
              <option value="SYSTEM">시스템</option>
            </select>
            <input
              style={input}
              placeholder="대상 ID (SOP·계획서)"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              disabled={targetType === '' || targetType === 'SYSTEM'}
            />
          </div>
          <button
            style={{ marginTop: '0.4rem' }}
            disabled={busy || !actions.canAddImprovement || actionText.trim().length === 0}
            onClick={() =>
              void run(async () =>
                setEvaluation(
                  await api.addImprovements(evaluation.evaluationId, [
                    {
                      actionText,
                      targetType: targetType === '' ? undefined : targetType,
                      targetId:
                        targetType === 'SOP' || targetType === 'PLAN' ? targetId : undefined,
                    },
                  ]),
                ),
              )
            }
            data-testid="add-improvement"
          >
            조치 등록
          </button>
          <ul style={{ fontSize: '0.82rem', marginTop: '0.5rem', paddingLeft: '1rem' }}>
            {evaluation.improvements.map((a) => (
              <li key={a.actionId}>
                {a.actionText} {a.targetType ? `→ ${a.targetType}` : ''} ({a.status})
              </li>
            ))}
          </ul>
          <button
            disabled={busy || !actions.canConfirm}
            onClick={() =>
              void run(async () => setEvaluation(await api.confirm(evaluation.evaluationId)))
            }
            data-testid="confirm"
          >
            평가 확정 (이 뒤로는 고칠 수 없습니다)
          </button>
        </section>
      )}

      {/* ── 보고서 (SCR-EVAL-004, UNE-JNL-015) ──────────────────────────── */}
      {evaluation && (
        <section style={panel}>
          <h2 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>4. 평가보고서</h2>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => setReport(await api.report(evaluation.evaluationId)))
            }
            data-testid="report"
          >
            보고서 보기
          </button>
          {report && (
            <div style={{ marginTop: '0.6rem' }}>
              {/* 부재를 빈 값이 아니라 말로 채운다. */}
              <Banner tone="info">만족도: {report.satisfaction.reason}</Banner>
              {report.criteriaWithoutEvidence.length > 0 && (
                <Banner tone="warn">
                  근거 없이 매긴 지표 {report.criteriaWithoutEvidence.length}건:{' '}
                  {report.criteriaWithoutEvidence.join(', ')}
                </Banner>
              )}
              <ul style={{ fontSize: '0.82rem', paddingLeft: '1rem' }}>
                {report.improvementsByTarget.map((row) => (
                  <li key={row.targetType}>
                    {row.targetType} 환류 {row.count}건
                  </li>
                ))}
              </ul>
              <p style={{ fontSize: '0.72rem', color: '#64748b' }}>
                형식은 JSON뿐입니다. HWPX·PDF 평가보고서 양식은 아직 없습니다.
              </p>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
