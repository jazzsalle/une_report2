import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { del, get, post, put, sse, MANUAL_STAGES, HAZARDS, coopIndex, type ActionCard, type ExtractProgress, type Manual, type ManualStage, type Org, type SopTemplateSummary } from '../api';
import { Btn, C, Card, Chip, Field, Input, Modal, Select, Textarea, Toast, useToast, useUser } from '../ui';

/**
 * 매뉴얼·SOP 템플릿 (범용화 ②, 2026-08-23) — 예전 "연계 데이터"(정적 목업) 자리.
 * 유니에 올라간 현장조치 행동매뉴얼에서 조치카드(코드·조치·주관/지원/협업·연계코드)를 추출 → 사람이 검수 → SOP 템플릿으로 묶는다.
 * 추출은 유니 검색을 순차로 13~60회 돌리므로(결과 1건당 약 1.2초) 진행 막대를 SSE로 흘린다.
 */
const STAGE_TONE: Record<string, 'gray' | 'blue' | 'green' | 'orange' | 'red' | 'purple'> = { 징후감지: 'gray', 초기대응: 'blue', 비상1: 'orange', '비상2·3': 'red', 수습복구: 'green' };
const PHASE_LABEL: Record<ExtractProgress['phase'], string> = { search: '협업기능별 검색', deep: '단계별 정밀 검색', gap: '코드 빈자리 채우기', done: '완료' };

export function SitManuals() {
  const [user] = useUser();
  const [toast, show] = useToast();
  const [list, setList] = useState<Manual[]>([]);
  const [org, setOrg] = useState<Org | null>(null);
  const [sp] = useSearchParams();
  const [selId, setSelId] = useState<string | null>(() => sp.get('manual')); // ?manual=<id> 로 특정 매뉴얼을 바로 연다(링크·캡처용)
  const [cards, setCards] = useState<ActionCard[]>([]);
  const [templates, setTemplates] = useState<SopTemplateSummary[]>([]);
  const [prog, setProg] = useState<ExtractProgress | null>(null);
  const [progLog, setProgLog] = useState<string[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [editCard, setEditCard] = useState<ActionCard | null>(null);
  const [srcCard, setSrcCard] = useState<ActionCard | null>(null);
  const [fStage, setFStage] = useState('');
  const [fCoop, setFCoop] = useState('');
  const [fQ, setFQ] = useState('');
  const [fUnreviewed, setFUnreviewed] = useState(false);
  const sel = list.find((m) => m.id === selId) ?? null;
  const coopName = (code: string) => org?.coopFunctions.find((c) => c.code === code)?.name ?? '';

  const loadList = async () => { const l = await get<Manual[]>('/manuals'); setList(l); if (!selId && l[0]) setSelId(l[0].id); return l; };
  const loadCards = async (id: string) => { setCards(await get<ActionCard[]>(`/manuals/${id}/cards`)); };
  const loadTemplates = async () => setTemplates(await get<SopTemplateSummary[]>('/sop-templates'));
  useEffect(() => { void loadList(); get<Org>('/org').then(setOrg).catch(() => {}); void loadTemplates(); }, []);
  useEffect(() => { if (selId) void loadCards(selId); else setCards([]); }, [selId]);

  const extract = (depth: 'quick' | 'deep') => {
    if (!sel) return;
    setProg({ phase: 'search', i: 0, total: 0, query: '', found: 0, unique: 0, elapsedMs: 0 }); setProgLog([]);
    sse(`/manuals/${sel.id}/extract/stream?depth=${depth}`, {
      progress: (d) => { const p = d as ExtractProgress; setProg(p); setProgLog((l) => [...l.slice(-7), `${PHASE_LABEL[p.phase]} ${p.i}/${p.total} · +${p.found} · 누적 ${p.unique}장 · ${p.query.slice(0, 60)}`]); },
      done: (d) => { const r = d as { cardCount: number; added: number; updated: number; elapsedMs: number; queries: number; skippedDocs: string[] }; setProg(null); show(`조치카드 ${r.cardCount}장 (신규 ${r.added} · 갱신 ${r.updated}) · 질의 ${r.queries}회 · ${Math.round(r.elapsedMs / 1000)}초`); void loadList(); void loadCards(sel.id); },
      error: (d) => { setProg(null); show(`추출 실패: ${(d as { error?: string }).error ?? ''}`); },
    });
  };
  const saveCard = async (c: ActionCard, patch: Partial<ActionCard>) => { const r = await put<ActionCard>(`/manuals/${c.manualId}/cards/${c.id}`, patch); setCards((cs) => cs.map((x) => (x.id === r.id ? r : x))); return r; };
  const removeCard = async (c: ActionCard) => { await del(`/manuals/${c.manualId}/cards/${c.id}`); setCards((cs) => cs.filter((x) => x.id !== c.id)); show(`${c.code} 삭제`); };
  const removeManual = async (m: Manual) => { await del(`/manuals/${m.id}?by=${encodeURIComponent(user?.name ?? '')}`); show('매뉴얼을 휴지통으로 옮겼습니다'); setSelId(null); void loadList(); };
  const removeTemplate = async (t: SopTemplateSummary) => { await del(`/sop-templates/${t.id}?by=${encodeURIComponent(user?.name ?? '')}`); show('템플릿을 휴지통으로 옮겼습니다'); void loadTemplates(); void loadList(); };

  const coopsPresent = useMemo(() => [...new Set(cards.map((c) => c.coop).filter(Boolean))].sort((a, b) => coopIndex(a) - coopIndex(b)), [cards]);
  const shown = cards.filter((c) => (!fStage || (fStage === '미상' ? !c.stage : c.stage === fStage)) && (!fCoop || (fCoop === '__none' ? !c.coop : c.coop === fCoop)) && (!fUnreviewed || !c.reviewed) && (!fQ || [c.code, c.title, c.content, c.lead, ...c.support, ...c.partner].join(' ').includes(fQ)));
  const stats = { total: cards.length, reviewed: cards.filter((c) => c.reviewed).length, truncated: cards.filter((c) => c.truncated).length, noStage: cards.filter((c) => !c.stage).length };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', height: '100%', minHeight: 0 }}>
      {/* 좌: 매뉴얼 목록 + 템플릿 목록 */}
      <div style={{ borderRight: `1px solid ${C.border}`, background: '#fff', overflow: 'auto', padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><b style={{ fontSize: 14 }}>매뉴얼</b><div style={{ flex: 1 }} /><Btn small kind="primary" onClick={() => setNewOpen(true)}>+ 등록</Btn></div>
        {!list.length && <div style={{ fontSize: 12, color: C.muted, padding: '10px 0' }}>등록된 매뉴얼이 없습니다. 유니에 올라간 현장조치 행동매뉴얼을 등록하고 조치카드를 추출하세요.</div>}
        {list.map((m) => (
          <div key={m.id} onClick={() => setSelId(m.id)} style={{ padding: '10px 12px', border: `1px solid ${selId === m.id ? C.blue : C.border}`, borderRadius: 8, marginBottom: 6, cursor: 'pointer', background: selId === m.id ? C.blueLight : '#fff' }}>
            <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.4 }}>{m.name}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{m.hazard} · {m.tier} · {m.org || '기관 미지정'}</div>
            <div style={{ fontSize: 11, marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}><Chip tone={m.cardCount ? 'blue' : 'gray'}>카드 {m.cardCount}</Chip>{m.reviewedCount ? <Chip tone="green">검수 {m.reviewedCount}</Chip> : null}{m.templateCount ? <Chip tone="purple">템플릿 {m.templateCount}</Chip> : null}{m.extracting ? <Chip tone="orange">추출 중</Chip> : null}</div>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', margin: '18px 0 8px' }}><b style={{ fontSize: 14 }}>SOP 템플릿</b><span style={{ fontSize: 11, color: C.muted, marginLeft: 6 }}>{templates.length}개</span></div>
        {!templates.length && <div style={{ fontSize: 12, color: C.muted }}>카드를 검수한 뒤 [SOP 템플릿 만들기]로 만듭니다. 상황 생성 화면에서 재난유형에 맞는 템플릿을 고를 수 있습니다.</div>}
        {templates.map((t) => (
          <div key={t.id} style={{ padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 6, fontSize: 12 }}>
            <div style={{ fontWeight: 700 }}>{t.name}</div>
            <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{t.hazard} · 임무 {t.nodes}개 · {t.stages.length ? t.stages.join('·') : '전 단계'}{t.coops.length ? ` · ${t.coops.join('')}` : ''}</div>
            <div style={{ display: 'flex', gap: 4, marginTop: 6 }}><a className="k-btn tertiary xs" href={`/sit/new?hazard=${encodeURIComponent(t.hazard)}`} style={{ fontSize: 11 }}>이 템플릿으로 상황 생성</a><Btn small kind="danger" onClick={() => void removeTemplate(t)}>삭제</Btn></div>
          </div>
        ))}
      </div>
      {/* 우: 선택 매뉴얼의 카드 */}
      <div style={{ overflow: 'auto', padding: 16, minWidth: 0 }}>
        {!sel ? <div style={{ color: C.muted, padding: 40, textAlign: 'center' }}>왼쪽에서 매뉴얼을 고르거나 새로 등록하세요.</div> : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <div><div style={{ fontSize: 16, fontWeight: 800 }}>{sel.name}</div><div style={{ fontSize: 12, color: C.muted }}>검색어 "{sel.queryPrefix}" · 출처 필터 "{sel.docFilter || '(없음)'}" · {sel.extractedAt ? `마지막 추출 ${new Date(sel.extractedAt).toLocaleString('ko-KR')} (질의 ${sel.lastRun?.queries ?? '-'}회, ${Math.round((sel.lastRun?.elapsedMs ?? 0) / 1000)}초)` : '아직 추출 안 함'}{sel.docNames.length ? ` · 출처 ${sel.docNames.join(', ')}` : ''}</div></div>
              <div style={{ flex: 1 }} />
              <Btn small disabled={!!prog || sel.extracting} onClick={() => extract('quick')} title="협업기능별 13회 검색 (약 5분)">{sel.cardCount ? '다시 추출' : '조치카드 추출'}</Btn>
              <Btn small disabled={!!prog || sel.extracting} onClick={() => extract('deep')} title="+ 단계×협업기능 65회 + 코드 빈자리 채우기 (약 20분)">정밀 추출</Btn>
              <Btn small kind="primary" disabled={!cards.length} onClick={() => setTplOpen(true)}>SOP 템플릿 만들기</Btn>
              <Btn small kind="danger" onClick={() => void removeManual(sel)}>매뉴얼 삭제</Btn>
            </div>
            {prog && (
              <Card pad={12} style={{ marginBottom: 10, background: C.blueLight }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}><b>{PHASE_LABEL[prog.phase]}</b><span>{prog.i}/{prog.total || '?'}</span><span style={{ color: C.muted }}>누적 {prog.unique}장 · {Math.round(prog.elapsedMs / 1000)}초</span><div style={{ flex: 1 }} /><span style={{ fontSize: 11, color: C.muted }}>유니 검색은 결과 1건당 약 1.2초가 걸립니다</span></div>
                <div style={{ height: 8, background: '#fff', borderRadius: 4, marginTop: 8, overflow: 'hidden' }}><div style={{ height: '100%', width: `${prog.total ? Math.round((prog.i / prog.total) * 100) : 3}%`, background: C.blue, transition: 'width .3s' }} /></div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>{progLog.map((l, i) => <div key={i}>{l}</div>)}</div>
              </Card>
            )}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', fontSize: 12 }}>
              <Chip tone="blue">카드 {stats.total}</Chip><Chip tone="green">검수 {stats.reviewed}</Chip>{stats.truncated ? <Chip tone="orange">잘림 {stats.truncated}</Chip> : null}{stats.noStage ? <Chip tone="gray">단계 미상 {stats.noStage}</Chip> : null}
              <div style={{ flex: 1 }} />
              <Select value={fStage} onChange={(e) => setFStage(e.target.value)} style={{ width: 130, height: 32 }}><option value="">단계 전체</option>{MANUAL_STAGES.map((s) => <option key={s}>{s}</option>)}<option value="미상">단계 미상</option></Select>
              <Select value={fCoop} onChange={(e) => setFCoop(e.target.value)} style={{ width: 200, height: 32 }}><option value="">협업기능 전체</option>{cards.some((c) => !c.coop) && <option value="__none">협업기능 없음</option>}{coopsPresent.map((c) => <option key={c} value={c}>{c} {coopName(c)}</option>)}</Select>
              <Input value={fQ} onChange={(e) => setFQ(e.target.value)} placeholder="코드·조치·부서 검색" style={{ width: 200, height: 32 }} />
              <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={fUnreviewed} onChange={(e) => setFUnreviewed(e.target.checked)} />미검수만</label>
            </div>
            <table className="k-tbl compact" style={{ width: '100%', fontSize: 12.5 }}>
              <thead><tr><th style={{ width: 36 }}>검수</th><th style={{ width: 70 }}>코드</th><th style={{ width: 108 }}>단계</th><th style={{ width: 120 }}>협업기능</th><th>조치</th><th style={{ width: 150 }}>주관부서</th><th style={{ width: 170 }}>지원 · 협업</th><th style={{ width: 110 }}>연계</th><th style={{ width: 120 }}></th></tr></thead>
              <tbody>
                {!shown.length && <tr><td colSpan={9} style={{ textAlign: 'center', color: C.muted, padding: 24 }}>{cards.length ? '조건에 맞는 카드가 없습니다' : '[조치카드 추출]을 누르세요'}</td></tr>}
                {shown.map((c) => (
                  <tr key={c.id} style={{ background: c.reviewed ? '#fff' : '#fffdf5' }}>
                    <td style={{ textAlign: 'center' }}><input type="checkbox" checked={c.reviewed} onChange={(e) => void saveCard(c, { reviewed: e.target.checked })} title="검수 완료" /></td>
                    <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{c.code}{c.truncated && <span title="청크 경계에 잘린 카드 — 원문 확인" style={{ color: C.orange, marginLeft: 3 }}>⚠</span>}</td>
                    <td><Select value={c.stage ?? ''} onChange={(e) => void saveCard(c, { stage: (e.target.value || null) as ManualStage | null })} style={{ height: 28, fontSize: 12, padding: '0 2px 0 4px', width: 100, borderColor: c.stage ? undefined : C.orange }}><option value="">미상</option>{MANUAL_STAGES.map((s) => <option key={s}>{s}</option>)}</Select></td>
                    <td style={{ fontSize: 11.5 }}>{c.coop ? <><Chip tone={STAGE_TONE[c.stage ?? ''] ?? 'gray'} style={{ marginRight: 4 }}>{c.coop}</Chip>{coopName(c.coop)}</> : <span style={{ color: C.muted }}>(코드에 협업기능 없음)</span>}</td>
                    <td><div style={{ fontWeight: 700 }}>{c.content || '(조치내용 없음)'}</div><div style={{ fontSize: 11, color: C.muted }}>{c.title}{c.checklist.length ? ` · 세부 ${c.checklist.length}` : ''}</div></td>
                    <td style={{ fontSize: 12 }}>{c.lead || '-'}</td>
                    <td style={{ fontSize: 11.5, color: C.muted }}>{c.support.length ? <div>ⓢ {c.support.join(', ')}</div> : null}{c.partner.length ? <div>ⓒ {c.partner.join(', ')}</div> : null}</td>
                    <td style={{ fontSize: 11, color: C.muted }}>{c.linkedCodes.map((l) => l.code).join(' ') || '-'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}><Btn small onClick={() => setEditCard(c)}>편집</Btn> <Btn small onClick={() => setSrcCard(c)} title="검색 발췌 원문">원문</Btn> <Btn small kind="danger" onClick={() => void removeCard(c)}>×</Btn></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 8, lineHeight: 1.6 }}>단계는 검색 청크의 앞뒤 문맥(“지대본 비상 1단계” 등)으로 추정한 값입니다 — 검수하며 바로잡으세요. 검수한 카드의 단계는 다시 추출해도 유지됩니다. ⚠는 512자 청크 경계에 잘려 지원부서·연계코드가 빠졌을 수 있는 카드입니다.</div>
          </>
        )}
      </div>
      {newOpen && <NewManualModal onClose={() => setNewOpen(false)} onSaved={(m) => { setNewOpen(false); setSelId(m.id); void loadList(); show('매뉴얼을 등록했습니다 — [조치카드 추출]을 누르세요'); }} />}
      {tplOpen && sel && <TemplateModal manual={sel} cards={cards} coopName={coopName} onClose={() => setTplOpen(false)} onSaved={(t) => { setTplOpen(false); show(`SOP 템플릿 "${t.name}" 생성 (임무 ${t.graph.nodes.length}개)`); void loadTemplates(); void loadList(); }} />}
      {editCard && <CardEditModal card={editCard} onClose={() => setEditCard(null)} onSave={async (patch) => { await saveCard(editCard, patch); setEditCard(null); show('카드를 저장했습니다'); }} />}
      {srcCard && <Modal title={`${srcCard.code} 원문 발췌 — ${srcCard.sourceRef.doc}`} onClose={() => setSrcCard(null)} width={720}><div style={{ fontSize: 11.5, color: C.muted, marginBottom: 6 }}>유사도 {Math.round(srcCard.sourceRef.score * 100)}% · 검색어: {srcCard.sourceRef.query}</div><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, lineHeight: 1.6, background: '#f4f5f6', padding: 12, borderRadius: 8, maxHeight: 420, overflow: 'auto', fontFamily: 'inherit' }}>{srcCard.sourceRef.excerpt}</pre></Modal>}
      <Toast msg={toast} />
    </div>
  );
}

function NewManualModal({ onClose, onSaved }: { onClose: () => void; onSaved: (m: Manual) => void }) {
  const [docs, setDocs] = useState<{ doc_id: string; filename: string }[] | null>(null);
  const [f, setF] = useState({ name: '', hazard: '태풍/호우', tier: '현장조치' as Manual['tier'], org: '', queryPrefix: '', docFilter: '' });
  useEffect(() => { get<{ documents: { doc_id: string; filename: string }[] }>('/uni/manual-docs').then((r) => setDocs(r.documents)).catch(() => setDocs([])); }, []);
  const pick = (fn: string) => { const base = fn.replace(/\.(pdf|hwpx?|docx?)$/i, ''); const org = /\(([^)]+)\)/.exec(base)?.[1] ?? ''; const name = base.replace(/^\([^)]+\)\s*/, '').trim(); setF((x) => ({ ...x, name: org ? `${org} ${name}` : name, org, queryPrefix: org ? `${org} ${name}` : name, docFilter: org || name.slice(0, 6), hazard: /풍수해|태풍|호우/.test(name) ? '태풍/호우' : /지진/.test(name) ? '지진' : /산불/.test(name) ? '산불' : /감염/.test(name) ? '감염병' : /폭염/.test(name) ? '폭염' : x.hazard })); };
  const save = async () => { if (!f.name.trim()) return; onSaved(await post<Manual>('/manuals', f)); };
  return (
    <Modal title="매뉴얼 등록" onClose={onClose} width={620}>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>유니에 올라간 문서 중 매뉴얼 후보입니다. 고르면 이름·검색어·출처 필터가 채워집니다.</div>
      <div style={{ maxHeight: 160, overflow: 'auto', border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 10 }}>
        {docs === null ? <div style={{ padding: 10, fontSize: 12, color: C.muted }}>유니 문서 목록 조회 중…</div> : !docs.length ? <div style={{ padding: 10, fontSize: 12, color: C.muted }}>매뉴얼 후보가 없습니다(유니 연결 확인). 아래에 직접 입력하세요.</div>
          : docs.map((d) => <div key={d.doc_id} onClick={() => pick(d.filename)} style={{ padding: '6px 10px', fontSize: 12.5, cursor: 'pointer', borderBottom: `1px solid ${C.border}`, background: f.docFilter && d.filename.includes(f.docFilter) ? C.blueLight : '#fff' }}>{d.filename}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 10px' }}>
        <Field label="매뉴얼 이름" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="영천시 풍수해 현장조치 행동매뉴얼" /></Field>
        <Field label="기관"><Input value={f.org} onChange={(e) => setF({ ...f, org: e.target.value })} placeholder="영천시" /></Field>
        <Field label="재난유형"><Select value={f.hazard} onChange={(e) => setF({ ...f, hazard: e.target.value })}>{HAZARDS.map((h) => <option key={h}>{h}</option>)}</Select></Field>
        <Field label="매뉴얼 종류"><Select value={f.tier} onChange={(e) => setF({ ...f, tier: e.target.value as Manual['tier'] })}><option>현장조치</option><option>실무</option><option>표준</option></Select></Field>
        <Field label="검색어 앞머리" hint="유니 검색 질의마다 앞에 붙는 말"><Input value={f.queryPrefix} onChange={(e) => setF({ ...f, queryPrefix: e.target.value })} placeholder="영천시 풍수해 현장조치 행동매뉴얼" /></Field>
        <Field label="출처 필터" hint="파일명에 이 글자가 있는 결과만 채택"><Input value={f.docFilter} onChange={(e) => setF({ ...f, docFilter: e.target.value })} placeholder="영천" /></Field>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}><Btn onClick={onClose}>취소</Btn><Btn kind="primary" disabled={!f.name.trim()} onClick={() => void save()}>등록</Btn></div>
    </Modal>
  );
}

function CardEditModal({ card, onClose, onSave }: { card: ActionCard; onClose: () => void; onSave: (patch: Partial<ActionCard>) => Promise<void> }) {
  const [f, setF] = useState({ title: card.title, content: card.content, lead: card.lead, support: card.support.join(', '), partner: card.partner.join(', '), linked: card.linkedCodes.map((l) => l.code).join(' '), checklist: card.checklist.join('\n'), stage: card.stage ?? '', note: card.note ?? '' });
  const save = () => onSave({ title: f.title, content: f.content, lead: f.lead, support: f.support.split(/\s*,\s*/).filter(Boolean), partner: f.partner.split(/\s*,\s*/).filter(Boolean), linkedCodes: f.linked.split(/\s+/).filter(Boolean).map((code) => ({ code, title: card.linkedCodes.find((l) => l.code === code)?.title ?? '' })), checklist: f.checklist.split('\n').map((x) => x.trim()).filter(Boolean), stage: (f.stage || null) as ManualStage | null, note: f.note, reviewed: true });
  return (
    <Modal title={`조치카드 ${card.code} 편집`} onClose={onClose} width={640}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 10px' }}>
        <Field label="조치목록(묶음)"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="단계"><Select value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}><option value="">미상</option>{MANUAL_STAGES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
      </div>
      <Field label="조치내용" required><Input value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 10px' }}>
        <Field label="주관부서"><Input value={f.lead} onChange={(e) => setF({ ...f, lead: e.target.value })} /></Field>
        <Field label="ⓢ 지원부서(쉼표)"><Input value={f.support} onChange={(e) => setF({ ...f, support: e.target.value })} /></Field>
        <Field label="ⓒ 협업기관(쉼표)"><Input value={f.partner} onChange={(e) => setF({ ...f, partner: e.target.value })} /></Field>
      </div>
      <Field label="연계코드(공백 구분)"><Input value={f.linked} onChange={(e) => setF({ ...f, linked: e.target.value })} placeholder="①-3-1 ⑪-1-3" /></Field>
      <Field label="세부 조치(줄마다 하나)"><Textarea value={f.checklist} onChange={(e) => setF({ ...f, checklist: e.target.value })} style={{ minHeight: 90 }} /></Field>
      <Field label="검수 메모"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}><Btn onClick={onClose}>취소</Btn><Btn kind="primary" onClick={() => void save()}>저장 · 검수 완료</Btn></div>
    </Modal>
  );
}

function TemplateModal({ manual, cards, coopName, onClose, onSaved }: { manual: Manual; cards: ActionCard[]; coopName: (c: string) => string; onClose: () => void; onSaved: (t: { name: string; graph: { nodes: unknown[] } }) => void }) {
  const [user] = useUser();
  const coops = [...new Set(cards.map((c) => c.coop).filter(Boolean))].sort((a, b) => coopIndex(a) - coopIndex(b)); // 부산처럼 숫자 코드(협업기능 없음)는 필터에서 제외
  const [f, setF] = useState({ name: `${manual.hazard} 현장조치 SOP (${manual.org || manual.name})`, stages: [] as string[], coops: [] as string[], onlyReviewed: false, maxNodes: 0 });
  const pick = cards.filter((c) => (!f.onlyReviewed || c.reviewed) && (!f.coops.length || f.coops.includes(c.coop)) && (c.stage ? !f.stages.length || f.stages.includes(c.stage) : true));
  const toggle = (k: 'stages' | 'coops', v: string) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));
  const save = async () => onSaved(await post(`/manuals/${manual.id}/templates`, { ...f, maxNodes: f.maxNodes || undefined, by: user?.name }));
  return (
    <Modal title="SOP 템플릿 만들기" onClose={onClose} width={640}>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>고른 카드를 단계 → 협업기능 → 코드 순으로 이어 순서도를 만듭니다. 대피명령·위기경보 발령처럼 판단이 필요한 카드 앞에는 판단 노드가 들어갑니다. 만든 뒤 SOP 편집 화면에서 자유롭게 고칠 수 있습니다.</div>
      <Field label="템플릿 이름"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="단계 (비우면 전체)"><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{MANUAL_STAGES.map((s) => <Btn key={s} small kind={f.stages.includes(s) ? 'primary' : 'default'} onClick={() => toggle('stages', s)}>{s}</Btn>)}</div></Field>
      <Field label="협업기능 (비우면 전체)"><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{coops.map((c) => <Btn key={c} small kind={f.coops.includes(c) ? 'primary' : 'default'} onClick={() => toggle('coops', c)} title={coopName(c)}>{c} {coopName(c).slice(0, 8)}</Btn>)}</div></Field>
      <div style={{ display: 'flex', gap: 16, fontSize: 12.5, alignItems: 'center', marginBottom: 10 }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={f.onlyReviewed} onChange={(e) => setF({ ...f, onlyReviewed: e.target.checked })} />검수한 카드만</label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>최대 임무 수 <Input type="number" value={f.maxNodes || ''} onChange={(e) => setF({ ...f, maxNodes: Number(e.target.value) || 0 })} placeholder="제한 없음" style={{ width: 100, height: 32 }} /></label>
      </div>
      <div style={{ fontSize: 12.5, padding: 8, background: '#f4f5f6', borderRadius: 8, marginBottom: 10 }}>선택 카드 <b>{pick.length}</b>장 → 임무 노드 {pick.length}개 + 판단 노드 약 {pick.filter((c) => /대피\s*명령|위기\s*경보|주민\s*대피|CBS|긴급\s*재난\s*문자/.test(c.content)).length}개 + 시작·종료. {pick.length > 40 && <span style={{ color: C.orange }}>40개가 넘으면 순서도가 길어집니다 — 단계·협업기능을 좁히거나 스윔레인 보기를 쓰세요.</span>}</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}><Btn onClick={onClose}>취소</Btn><Btn kind="primary" disabled={!pick.length} onClick={() => void save()}>템플릿 생성</Btn></div>
    </Modal>
  );
}
