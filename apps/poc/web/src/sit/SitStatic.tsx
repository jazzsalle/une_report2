import { useEffect, useState } from 'react';
import { get } from '../api';
import { Btn, C, Card, Chip, Field, Select, Table } from '../ui';

/** 연계 데이터 조회 / 환경설정 — POC 범위: 정적 목업 + 유니 문서 목록 실연동 */
export function SitStatic({ kind }: { kind: 'data' | 'settings' }) {
  const [docs, setDocs] = useState<{ documents: { doc_id: string; filename: string; status: string; progress: number; uploaded_at?: string }[]; total: number; error?: string } | null>(null);
  const [health, setHealth] = useState<{ uni: { baseUrl: string; mock: boolean; lastFailure: string | null; model: string }; t3q: { baseUrl: string; verifyTls: boolean } } | null>(null);
  useEffect(() => { if (kind === 'data') get<typeof docs>('/uni/documents?page=1&size=15').then(setDocs).catch(() => setDocs({ documents: [], total: 0, error: '조회 실패' })); get<typeof health>('/health').then(setHealth); }, [kind]);
  if (kind === 'data') return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}><b style={{ fontSize: 16 }}>연계 데이터 조회</b><Chip tone="navy">T3Q AI·RAG 연계</Chip><span style={{ fontSize: 12, color: C.muted }}>SOP·상황일지 생성에 활용되는 연계 데이터 현황입니다.</span><div style={{ flex: 1 }} /><Btn small onClick={() => get<typeof docs>('/uni/documents?page=1&size=15').then(setDocs)}>↻ 동기화</Btn></div>
      <Card>
        <Table head={['데이터 유형', '문서/데이터명', '출처', '최근 수신', '활용처', '상태']} rows={[
          ['위기관리매뉴얼', '풍수해 위기관리 표준매뉴얼 (2026 개정)', 'T3Q AI 플랫폼', '06-15 08:40', 'SOP 생성 근거', <Chip tone="green">정상</Chip>],
          ['재난상황정보', '○○천 수위 관측 데이터', 'T3Q AI 플랫폼', '06-15 09:10', 'AI 상황분석', <Chip tone="blue">동기화중</Chip>],
          ['재난대응정보', '유관기관 대응 자원 현황', 'T3Q AI 플랫폼', '06-15 08:55', '임무 배정안', <Chip tone="green">정상</Chip>],
          ['훈련자료', '2025 안전한국훈련 결과 보고서', 'UNE 내부', '06-14 17:00', '유사 사례 참조', <Chip tone="green">정상</Chip>],
          ...(docs?.documents ?? []).map((d) => ['유니 RAG 문서', d.filename, '유니(UNE Intelligence)', d.uploaded_at ? new Date(d.uploaded_at).toLocaleDateString('ko-KR') : '-', 'SOP 생성 · 챗봇 근거', <Chip tone={d.status === '완료' ? 'green' : 'blue'}>{d.status}{d.progress < 100 ? ` ${d.progress}%` : ''}</Chip>]),
        ]} />
        <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>위 4행은 정적 목업, 이후 행은 유니 GET /documents/ 실시간 조회 (총 {docs?.total ?? '-'}건 중 15건){docs?.error ? ` — ${docs.error}` : ''}. 훈련상황 생성 화면에서는 이 목록을 노출하지 않고 챗봇 질의로만 접근합니다.</div>
      </Card>
    </div>
  );
  return (
    <div style={{ padding: 20, maxWidth: 720 }}>
      <b style={{ fontSize: 16 }}>환경설정</b>
      <Card style={{ marginTop: 12 }} title="일반">
        <Field label="테마"><Select defaultValue="라이트"><option>라이트</option><option disabled>다크 (후속)</option></Select></Field>
        <Field label="기본 전파 채널"><Select defaultValue="문자 + 알림톡"><option>문자 + 알림톡</option><option>문자</option><option>내부알림</option></Select></Field>
        <Field label="지연 판정 기준"><Select defaultValue="완료기한 경과 즉시"><option>완료기한 경과 즉시</option><option>기한 + 5분</option><option>기한 + 10분</option></Select></Field>
        <Field label="상황일지 자동기록 기본값"><div style={{ fontSize: 12.5 }}>{['전파 시', '수신 확인 시', '완료 보고 시', '지연 발생 시'].map((r) => <label key={r} style={{ display: 'inline-flex', gap: 4, marginRight: 14 }}><input type="checkbox" defaultChecked />{r}</label>)}</div></Field>
        <Btn kind="primary" onClick={() => alert('적용되었습니다 (POC: 저장 안 함)')}>적용하기</Btn>
      </Card>
      <Card style={{ marginTop: 12 }} title="연동 상태">
        {health && <div style={{ fontSize: 12.5, lineHeight: 2 }}>유니 RAG: <b>{health.uni.baseUrl}</b> · 모델 {health.uni.model} {health.uni.mock ? <Chip tone="orange">목업</Chip> : health.uni.lastFailure ? <Chip tone="orange">오류→목업</Chip> : <Chip tone="green">연결</Chip>}<br />T3Q: <b>{health.t3q.baseUrl}</b> {health.t3q.verifyTls ? '' : <Chip tone="orange">TLS 검증 해제(POC)</Chip>}</div>}
      </Card>
    </div>
  );
}
