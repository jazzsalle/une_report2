import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from './api';
import { C, Card, Chip, Select, useUser } from './ui';

export function Home() {
  const [user, setUser, users] = useUser();
  const [health, setHealth] = useState<{ uni: { baseUrl: string; mock: boolean; lastFailure: string | null }; t3q: { baseUrl: string; verifyTls: boolean; lastFailure: string | null }; rhwp: { version: string } } | null>(null);
  useEffect(() => { get<typeof health>('/health').then(setHealth).catch(() => setHealth(null)); }, []);
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '48px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 32 }}>
        <div>
          <div style={{ fontSize: 13, color: C.muted, fontWeight: 700, letterSpacing: 1 }}>UNE · 재난관리 업무지원 서비스 POC</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 30, color: C.navy }}>재난안전 AI 문서 플랫폼</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: C.muted }}>사용자</span>
          <Select value={user?.id ?? ''} onChange={(e) => { const u = users.find((x) => x.id === e.target.value); if (u) setUser(u); }} style={{ width: 220 }}>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.dept}</option>)}
          </Select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'stretch' }}>
        <Link to="/plan" style={{ textDecoration: 'none', color: 'inherit' }}>
          <Card style={{ padding: 28, height: '100%', boxSizing: 'border-box', borderTop: `4px solid ${C.blue}` }}>
            <div style={{ fontSize: 12, color: C.blue, fontWeight: 800 }}>문서 생성 도구</div>
            <div style={{ fontSize: 22, fontWeight: 800, margin: '6px 0 10px' }}>재난안전계획서 생성</div>
            <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.7, margin: 0 }}>HWPX 템플릿의 스타일을 분석하고, 기준정보 → 목차 → 초안(T3Q 스트리밍) → 문단 선택 챗봇 편집 → HWPX 내보내기까지 한 흐름으로.</p>
            <div style={{ marginTop: 16, display: 'flex', gap: 6, flexWrap: 'wrap' }}><Chip tone="blue">템플릿 스타일 분석</Chip><Chip tone="blue">T3Q 목차·초안</Chip><Chip tone="blue">rhwp HWPX</Chip><Chip tone="blue">챗봇 문단 수정</Chip></div>
          </Card>
        </Link>
        <Link to="/sit" style={{ textDecoration: 'none', color: 'inherit' }}>
          <Card style={{ padding: 28, height: '100%', boxSizing: 'border-box', borderTop: `4px solid ${C.navy}` }}>
            <div style={{ fontSize: 12, color: C.navy, fontWeight: 800 }}>안전한국훈련</div>
            <div style={{ fontSize: 22, fontWeight: 800, margin: '6px 0 10px' }}>상황일지 생성 도구</div>
            <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.7, margin: 0 }}>훈련상황 생성 → 유니 SOP 생성/편집 → 임무 전파 → 모바일 현장 확인 → 전자상황판 → 상황일지 자동 생성.</p>
            <div style={{ marginTop: 16, display: 'flex', gap: 6, flexWrap: 'wrap' }}><Chip tone="navy">유니 SOP</Chip><Chip tone="navy">임무 전파</Chip><Chip tone="navy">전자 상황판</Chip><Chip tone="navy">상황일지 HWPX</Chip></div>
          </Card>
        </Link>
      </div>

      <Card title="연동 상태" style={{ marginTop: 20 }}>
        {health ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, fontSize: 12 }}>
            <div><b>T3Q</b> (목차·초안) <Chip tone={health.t3q.lastFailure ? 'orange' : 'green'}>{health.t3q.lastFailure ? '오류' : '연결'}</Chip><div style={{ color: C.muted, marginTop: 4 }}>{health.t3q.baseUrl}{!health.t3q.verifyTls && ' · TLS 검증 해제(POC)'}</div>{health.t3q.lastFailure && <div style={{ color: C.red, marginTop: 2 }}>{health.t3q.lastFailure}</div>}</div>
            <div><b>유니 RAG</b> (SOP·서술) <Chip tone={health.uni.mock ? 'orange' : health.uni.lastFailure ? 'orange' : 'green'}>{health.uni.mock ? '목업' : health.uni.lastFailure ? '오류→목업' : '연결'}</Chip><div style={{ color: C.muted, marginTop: 4 }}>{health.uni.baseUrl}</div>{health.uni.lastFailure && <div style={{ color: C.red, marginTop: 2 }}>{health.uni.lastFailure}</div>}</div>
            <div><b>rhwp</b> (HWPX 엔진) <Chip tone="green">v{health.rhwp.version}</Chip><div style={{ color: C.muted, marginTop: 4 }}>@rhwp/core WASM · 서버 내장</div></div>
          </div>
        ) : <span style={{ color: C.red, fontSize: 13 }}>서버(:3100)에 연결할 수 없습니다. `pnpm --filter @une/poc dev`로 기동하세요.</span>}
      </Card>
      <div style={{ marginTop: 20, fontSize: 12, color: C.muted }}>모바일 현장 담당자 화면: {users.slice(0, 5).map((u) => <Link key={u.id} to={`/m/${u.id}`} style={{ marginRight: 10 }}>{u.name}</Link>)}</div>
    </div>
  );
}
