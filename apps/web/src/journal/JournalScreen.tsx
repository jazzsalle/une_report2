import { useCallback, useMemo, useState, type JSX } from 'react';
import type { ApiClient } from '../api/client';
import { ApiCallError, describeFailure, nextActionFor } from '../api/errors';
import { JournalApi, type JournalDetail, type NarrativeProposal } from './journal-api';
import {
  JOURNAL_STATUS_LABELS,
  NARRATIVE_SOURCE_LABELS,
  contradictionNotes,
  driftBanner,
  factRows,
  journalActions,
} from './journal-state';

/**
 * 상황일지 화면 (CC-300, 설계 09 SCR-JRN-001~006).
 *
 * 한 화면에 여섯 단계를 세로로 놓는다: 생성범위 → 사실칸·서술 → AI 제안 →
 * 검토요청 → 승인 → Export. 단계를 화면으로 쪼개면 사람이 "지금 무엇이
 * 사실이고 무엇이 내가 쓴 문장인지"를 화면 사이에서 잃는다.
 *
 * **사실칸에는 입력 요소가 없다.** 서버가 거절하기 전에 화면이 먼저 그것을
 * 손댈 수 없는 것으로 보여야 한다.
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

const label: React.CSSProperties = { fontSize: '0.78rem', color: '#475569', display: 'block' };

function Banner({
  tone,
  children,
}: {
  tone: 'warn' | 'bad' | 'info';
  children: React.ReactNode;
}): JSX.Element {
  const colors = {
    warn: { bg: '#fffbeb', border: '#fcd34d', fg: '#92400e' },
    bad: { bg: '#fef2f2', border: '#fca5a5', fg: '#991b1b' },
    info: { bg: '#eff6ff', border: '#bfdbfe', fg: '#1e40af' },
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

export function JournalScreen({
  client,
  situationId,
}: {
  client: ApiClient;
  situationId: string;
}): JSX.Element {
  const api = useMemo(() => new JournalApi(client), [client]);

  const [detail, setDetail] = useState<JournalDetail | null>(null);
  const [proposals, setProposals] = useState<NarrativeProposal[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [journalId, setJournalId] = useState('');
  const [templateFileId, setTemplateFileId] = useState('');
  const [snapshotId, setSnapshotId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reviewers, setReviewers] = useState('');
  const [comment, setComment] = useState('');
  const [exportNote, setExportNote] = useState<string | null>(null);

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

  const adopt = (next: JournalDetail): void => {
    setDetail(next);
    setJournalId(next.journal.journalId);
    setDrafts({});
  };

  const actions = detail ? journalActions(detail) : null;
  const drift = detail ? driftBanner(detail.journal) : null;

  return (
    <main style={{ maxWidth: '960px', margin: '0 auto', padding: '1rem' }}>
      <h1 style={{ fontSize: '1.2rem', marginBottom: '0.6rem' }}>상황일지</h1>

      {failure && <Banner tone="bad">{failure}</Banner>}

      {/* ── 생성범위·양식 (SCR-JRN-001, UNE-JNL-005) ─────────────────── */}
      <section style={panel}>
        <h2 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>생성범위와 양식</h2>
        <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.5rem' }}>
          일지는 반입된 HWPX 양식 사본 위에 만들어집니다. 양식이 없으면 승인 뒤에도 문서를 내보낼 수
          없습니다.
        </p>
        <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: '1fr 1fr' }}>
          <label style={label}>
            양식 파일 ID (검증된 HWPX)
            <input
              style={input}
              value={templateFileId}
              onChange={(e) => setTemplateFileId(e.target.value)}
              data-testid="template-file-id"
            />
          </label>
          <label style={label}>
            확정 판 ID (비우면 최신)
            <input
              style={input}
              value={snapshotId}
              onChange={(e) => setSnapshotId(e.target.value)}
            />
          </label>
          <label style={label}>
            기간 시작
            <input
              type="datetime-local"
              style={input}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label style={label}>
            기간 끝
            <input
              type="datetime-local"
              style={input}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
        <div style={{ marginTop: '0.6rem', display: 'flex', gap: '0.5rem' }}>
          <button
            disabled={busy || !templateFileId || !from || !to}
            onClick={() =>
              void run(async () =>
                adopt(
                  await api.project(situationId, {
                    templateFileId,
                    snapshotId: snapshotId || undefined,
                    from: new Date(from).toISOString(),
                    to: new Date(to).toISOString(),
                  }),
                ),
              )
            }
            data-testid="project"
          >
            상황일지 만들기
          </button>
          <input
            style={{ ...input, maxWidth: '320px' }}
            placeholder="이미 만든 일지 ID로 열기"
            value={journalId}
            onChange={(e) => setJournalId(e.target.value)}
          />
          <button
            disabled={busy || !journalId}
            onClick={() => void run(async () => adopt(await api.detail(journalId)))}
          >
            열기
          </button>
        </div>
      </section>

      {detail && actions && (
        <>
          <section style={panel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>
                {JOURNAL_STATUS_LABELS[detail.journal.status] ?? detail.journal.status}
              </strong>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                사실 해시 {detail.journal.projectionHash.slice(0, 12)}…
              </span>
            </div>
            {drift && (
              <div style={{ marginTop: '0.5rem' }}>
                <Banner tone="warn">{drift}</Banner>
                {actions.canRefresh && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => adopt(await api.refreshFacts(detail.journal.journalId)))
                    }
                    data-testid="refresh-facts"
                  >
                    사실 갱신 (사람이 쓴 문장은 그대로 둡니다)
                  </button>
                )}
              </div>
            )}
          </section>

          {/* ── 사실칸과 서술 (SCR-JRN-002~003, UNE-JNL-008) ───────────── */}
          {detail.cells.map((cell) => {
            const notes = contradictionNotes(cell);
            return (
              <section key={cell.sectionKey} style={panel}>
                <h3 style={{ fontSize: '0.92rem', marginBottom: '0.4rem' }}>{cell.title}</h3>

                <table
                  style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '0.5rem' }}
                >
                  <tbody>
                    {factRows(cell).map(([key, value]) => (
                      <tr key={key}>
                        <th
                          style={{
                            textAlign: 'left',
                            fontSize: '0.78rem',
                            color: '#475569',
                            padding: '0.2rem 0.4rem',
                            width: '35%',
                          }}
                        >
                          {key}
                        </th>
                        {/* 사실칸에는 입력 요소가 없다. 잠긴 것을 잠긴 모습으로 보인다. */}
                        <td
                          style={{
                            fontSize: '0.85rem',
                            padding: '0.2rem 0.4rem',
                            background: '#f8fafc',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                  🔒 위 값은 확정 판과 사실원장에서 접은 것입니다 — 편집·AI 어느 쪽으로도 바꿀 수
                  없습니다. 아래 문장만 고칠 수 있습니다.
                </span>

                {notes.length > 0 && <Banner tone="warn">{notes.join('\n')}</Banner>}

                <textarea
                  style={{ ...input, minHeight: '4rem', marginTop: '0.4rem' }}
                  value={drafts[cell.sectionKey] ?? cell.narrativeText ?? ''}
                  disabled={!actions.canEdit}
                  onChange={(e) => setDrafts((d) => ({ ...d, [cell.sectionKey]: e.target.value }))}
                  data-testid={`narrative-${cell.sectionKey}`}
                />
                <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                  {NARRATIVE_SOURCE_LABELS[cell.narrativeSource] ?? cell.narrativeSource}
                </div>
              </section>
            );
          })}

          <section style={panel}>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                disabled={busy || !actions.canEdit || Object.keys(drafts).length === 0}
                onClick={() =>
                  void run(async () =>
                    adopt(
                      await api.edit(
                        detail.journal.journalId,
                        Object.entries(drafts).map(([sectionKey, narrativeText]) => ({
                          sectionKey,
                          narrativeText,
                        })),
                      ),
                    ),
                  )
                }
                data-testid="save-narratives"
              >
                문장 저장
              </button>

              <button
                disabled={busy || !actions.canPropose}
                onClick={() =>
                  void run(async () => {
                    const result = await api.proposeNarratives(
                      detail.journal.journalId,
                      detail.cells.map((c) => c.sectionKey),
                    );
                    setProposals(result);
                    adopt(await api.detail(detail.journal.journalId));
                    setProposals(result);
                  })
                }
                data-testid="ai-draft"
              >
                AI 문안 제안
              </button>
            </div>

            {proposals.length > 0 && (
              <div style={{ marginTop: '0.6rem' }}>
                {proposals.some((p) => p.simulated) && (
                  <Banner tone="info">
                    지금 붙어 있는 문안 생성기는 시뮬레이션입니다. 실제 T3Q 서술 연산은 아직 계약에
                    없습니다(OB-03) — 이 결과를 T3Q 지원으로 읽지 마십시오.
                  </Banner>
                )}
                {proposals
                  .filter((p) => !p.accepted)
                  .map((p) => (
                    <Banner key={p.sectionKey} tone="warn">
                      {p.sectionKey}: 제안을 반영하지 않았습니다
                      {p.contradictions.length > 0
                        ? ` — 사실을 반박합니다(${p.contradictions.map((c) => c.field).join(', ')}).`
                        : ' — 사람이 쓴 문장은 덮지 않습니다.'}
                    </Banner>
                  ))}
              </div>
            )}
          </section>

          {/* ── 검토·승인 (SCR-JRN-004~005, UNE-JNL-009~010) ───────────── */}
          <section style={panel}>
            <h2 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>검토와 승인</h2>
            {actions.canSubmitReview && (
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  style={input}
                  placeholder="검토자 사용자 ID (쉼표로 구분)"
                  value={reviewers}
                  onChange={(e) => setReviewers(e.target.value)}
                />
                <button
                  disabled={busy || reviewers.trim().length === 0}
                  onClick={() =>
                    void run(async () =>
                      adopt(
                        await api.submitReview(
                          detail.journal.journalId,
                          reviewers
                            .split(',')
                            .map((r) => r.trim())
                            .filter(Boolean),
                        ),
                      ),
                    )
                  }
                  data-testid="submit-review"
                >
                  검토 요청
                </button>
              </div>
            )}
            {actions.canDecide && (
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <input
                  style={input}
                  placeholder="의견 (반려는 사유가 필요합니다)"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () =>
                      adopt(
                        await api.decide(
                          detail.journal.journalId,
                          'APPROVED',
                          comment || undefined,
                        ),
                      ),
                    )
                  }
                  data-testid="approve"
                >
                  승인
                </button>
                <button
                  disabled={busy || comment.trim().length === 0}
                  onClick={() =>
                    void run(async () =>
                      adopt(
                        await api.decide(detail.journal.journalId, 'CHANGES_REQUESTED', comment),
                      ),
                    )
                  }
                >
                  보완 요청
                </button>
              </div>
            )}
            {detail.approvals.length > 0 && (
              <ul style={{ fontSize: '0.8rem', marginTop: '0.5rem', paddingLeft: '1rem' }}>
                {detail.approvals.map((a) => (
                  <li key={a.journalApprovalId}>
                    {a.decision} · {new Date(a.decidedAt).toLocaleString('ko-KR')} · 사실 해시{' '}
                    {a.projectionHash.slice(0, 12)}…
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Export (SCR-JRN-006, UNE-JNL-011) ──────────────────────── */}
          <section style={panel}>
            <h2 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>내보내기</h2>
            {actions.exportBlockedReason && (
              <Banner tone="warn">{actions.exportBlockedReason}</Banner>
            )}
            <button
              disabled={busy || !actions.canExport}
              onClick={() =>
                void run(async () => {
                  const job = await api.export(detail.journal.journalId, 'HWPX');
                  setExportNote(`Export 접수됨 · ${job.exportId}`);
                })
              }
              data-testid="export"
            >
              HWPX로 내보내기
            </button>
            {exportNote && <p style={{ fontSize: '0.8rem', marginTop: '0.4rem' }}>{exportNote}</p>}
            <p style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.4rem' }}>
              투영 내용은 양식의 표 칸에 들어가지 않고 절 표제 뒤에 부기됩니다(ADR-44 수용 한계 2).
              PDF·DOCX는 어휘에만 있고 변환기가 없습니다(ADR-31).
            </p>
          </section>
        </>
      )}
    </main>
  );
}
