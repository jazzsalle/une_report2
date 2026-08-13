import { useMemo, useRef, useState, type JSX } from 'react';
import { ApiClient } from '../api/client';
import { ApiCallError, describeFailure } from '../api/errors';
import { SliceApi } from '../api/slice';
import { apiBaseUrl } from '../config';
import { SituationBoard } from '../board/SituationBoard';
import { EvaluationScreen } from '../evaluation/EvaluationScreen';
import { JournalScreen } from '../journal/JournalScreen';
import { buildMockExternalToken } from '../slice/mock-sso';

/**
 * 운영 화면 껍데기 — 전자상황판(CC-290)·상황일지(CC-300)·종료와 평가(CC-310).
 *
 * 둘 다 **상황 하나**를 두고 보는 화면이라 로그인과 상황 ID를 공유한다.
 * CC-290의 판은 이 껍데기가 생기기 전까지 어디에도 붙어 있지 않았다 — 만들어
 * 두고 걸지 않으면 없는 것과 같으므로 여기서 함께 건다.
 *
 * 계획서 슬라이스(CC-170)는 자기 로그인을 가진 완결된 흐름이라 건드리지 않고
 * 상위 App이 탭으로 나눈다.
 */

type Tab = 'board' | 'journal' | 'evaluation';

export function OpsWorkspace(): JSX.Element {
  const clientRef = useRef<ApiClient>(new ApiClient(apiBaseUrl()));
  const api = useMemo(() => new SliceApi(clientRef.current), []);

  const [tenantId, setTenantId] = useState('');
  const [loginId, setLoginId] = useState('');
  const [who, setWho] = useState<string | null>(null);
  const [situationId, setSituationId] = useState('');
  const [tab, setTab] = useState<Tab>('board');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const login = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      await api.exchange(
        buildMockExternalToken({ tenantId: tenantId.trim(), loginId: loginId.trim() }),
      );
      const me = await api.me();
      setWho(me.displayName ?? me.userId);
    } catch (error) {
      setFailure(error instanceof ApiCallError ? describeFailure(error.failure) : String(error));
    } finally {
      setBusy(false);
    }
  };

  const field: React.CSSProperties = {
    padding: '0.4rem 0.5rem',
    border: '1px solid #cbd5e1',
    borderRadius: '6px',
    fontSize: '0.9rem',
  };

  return (
    <div>
      <header
        style={{
          display: 'flex',
          gap: '0.5rem',
          alignItems: 'center',
          flexWrap: 'wrap',
          padding: '0.7rem 1rem',
          borderBottom: '1px solid #e2e8f0',
          background: '#f8fafc',
        }}
      >
        {who ? (
          <>
            <span style={{ fontSize: '0.85rem' }}>{who}</span>
            <input
              style={{ ...field, minWidth: '320px' }}
              placeholder="상황 ID (UUID)"
              value={situationId}
              onChange={(e) => setSituationId(e.target.value)}
              data-testid="situation-id"
            />
            <button onClick={() => setTab('board')} disabled={tab === 'board'}>
              전자상황판
            </button>
            <button onClick={() => setTab('journal')} disabled={tab === 'journal'}>
              상황일지
            </button>
            <button onClick={() => setTab('evaluation')} disabled={tab === 'evaluation'}>
              종료·평가
            </button>
          </>
        ) : (
          <>
            <input
              style={field}
              placeholder="기관 ID (UUID)"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              data-testid="ops-tenant-id"
            />
            <input
              style={field}
              placeholder="로그인 ID"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              data-testid="ops-login-id"
            />
            <button
              onClick={() => void login()}
              disabled={busy || !tenantId || !loginId}
              data-testid="ops-login"
            >
              로그인
            </button>
          </>
        )}
      </header>

      {failure && (
        <p style={{ color: '#991b1b', fontSize: '0.85rem', padding: '0.5rem 1rem' }}>{failure}</p>
      )}

      {who && situationId ? (
        tab === 'board' ? (
          <SituationBoard client={clientRef.current} situationId={situationId} />
        ) : tab === 'journal' ? (
          <JournalScreen client={clientRef.current} situationId={situationId} />
        ) : (
          <EvaluationScreen client={clientRef.current} situationId={situationId} />
        )
      ) : (
        <p style={{ padding: '1rem', fontSize: '0.9rem', color: '#64748b' }}>
          {who
            ? '상황 ID를 입력하십시오.'
            : '로그인하십시오. AUTH_MODE=mock 경로입니다(ADR-22 D3).'}
        </p>
      )}
    </div>
  );
}
