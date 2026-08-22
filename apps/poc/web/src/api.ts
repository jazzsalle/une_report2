/** 서버 API 얇은 클라이언트. 실패는 Error로 던진다. */
export async function api<T = unknown>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method,
    headers: form ? undefined : body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await r.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { error: text }; }
  if (!r.ok) throw new Error((json as { error?: string })?.error ?? `HTTP ${r.status}`);
  return json as T;
}
export const get = <T,>(p: string) => api<T>('GET', p);
export const post = <T,>(p: string, b?: unknown) => api<T>('POST', p, b);
export const put = <T,>(p: string, b?: unknown) => api<T>('PUT', p, b);
export const del = <T,>(p: string) => api<T>('DELETE', p);

/** SSE 구독. event별 콜백. 반환값으로 중단. */
export function sse(path: string, handlers: Record<string, (data: unknown) => void>): () => void {
  const es = new EventSource(`/api${path}`);
  for (const [ev, fn] of Object.entries(handlers)) es.addEventListener(ev, (e) => { try { fn(JSON.parse((e as MessageEvent).data)); } catch { fn((e as MessageEvent).data); } });
  es.onerror = () => { handlers.error?.({ message: '연결 끊김' }); es.close(); };
  const close = () => es.close();
  es.addEventListener('done', close); es.addEventListener('cancelled', close); es.addEventListener('error', close);
  return close;
}

// ── 파일 저장: "다른 이름으로 저장" 창 (File System Access API) ──
type SaveHandle = { createWritable(): Promise<{ write(d: Blob): Promise<void>; close(): Promise<void> }> };
type PickerWindow = Window & { showSaveFilePicker?: (o: { suggestedName?: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<SaveHandle> };

/** 저장 위치 창을 띄울 수 있는가 — Chrome/Edge이면서 보안 컨텍스트(localhost 또는 https)일 때만. http://10.x.x.x 접속에서는 false. */
export const canPickSaveLocation = () => typeof (window as PickerWindow).showSaveFilePicker === 'function';

/** 저장 위치 창. 브라우저가 "사용자 클릭 직후"에만 허용하므로 긴 await 전에 먼저 호출할 것. 미지원이면 null, 사용자가 취소하면 'cancelled'. */
export async function pickSaveLocation(suggestedName: string): Promise<SaveHandle | 'cancelled' | null> {
  const w = window as PickerWindow;
  if (typeof w.showSaveFilePicker !== 'function') return null;
  try { return await w.showSaveFilePicker({ suggestedName, types: [{ description: 'HWPX 문서', accept: { 'application/octet-stream': ['.hwpx'] } }] }); }
  catch (e) { if ((e as DOMException).name === 'AbortError') return 'cancelled'; throw e; }
}

/** 서버 파일을 고른 위치에 써 넣는다. 핸들이 null(미지원)이면 브라우저 기본 다운로드로 폴백. */
export async function writeFileTo(handle: SaveHandle | null, url: string, fileName: string): Promise<'saved' | 'downloaded'> {
  if (!handle) { const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove(); return 'downloaded'; }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`파일을 읽지 못했습니다 (HTTP ${r.status})`);
  const w = await handle.createWritable(); await w.write(await r.blob()); await w.close();
  return 'saved';
}

// ── 타입 (서버와 동일) ──
export interface User { id: string; name: string; dept: string; role: string }
export interface Level { level: number; styleId: number | null; styleName: string | null; bullet: string; fontFamily: string | null; fontSizePt: number | null; bold: boolean; indentHu: number; sampleText: string }
export interface CellStyle { fillType: string; fillColor: string; borderFillId: number; verticalAlign: number; height: number; paddingLeft: number; paddingRight: number; paddingTop: number; paddingBottom: number; charShapeId: number | null; paraShapeId: number | null; font: { fontFamily: string | null; fontSizePt: number | null; bold: boolean } }
/** 템플릿 견본 표의 모양 — 내보내기 표에 그대로 적용되고, 웹 미리보기의 표 머리행 색에도 쓴다 */
export interface TableStyle { table: { paddingLeft: number; paddingRight: number; paddingTop: number; paddingBottom: number; borderFillId: number; repeatHeader: boolean; cellSpacing: number }; header: CellStyle; firstCol: CellStyle; body: CellStyle; colWidths: number[]; sampleParaIdx: number; rows: number; cols: number; caption: { charShapeId: number | null; paraShapeId: number | null } | null }
export interface Template { id: string; name: string; fileName: string; builtin: boolean; createdAt: string; levels: Level[]; bodyFontFamily: string | null; bodyFontSizePt: number | null; styleCount: number; pageCount: number; styleRuleText: string; tableStyle?: TableStyle | null; profile?: { styles: { id: number; name: string }[]; numbering: { levelFormats: string[] }[]; paragraphs: { idx: number; text: string; styleName: string; fontSizePt: number | null; bold: boolean; bullet: string }[]; fontsUsed: string[] } }
export interface PlanContext { subject: string; hazardType: string; managementPhase: string; place?: string; occurredAt?: string; reportedAt?: string; sources?: string; requiredElements?: string; writingGuide?: string; tone?: string; sentenceLimit?: string; outlineNumbering?: string; bodyStart?: string; purpose?: string; role?: string; audience?: string; templateId?: string | null; linkedExerciseId?: string | null }
/** 기준정보 템플릿(기준정보 입력값 저장본) — HWPX 문서 템플릿(Template)과 다른 것 */
export interface PlanTemplate { id: string; name: string; context: PlanContext; createdBy: string; updatedBy?: string; createdAt: string; updatedAt: string }
export interface TocNode { id: string; no: string; title: string; children: TocNode[] }
/** 초안을 만드는 목차 항목 — 하위 목차가 있는 장은 제목만(서버 main.ts와 같은 규칙) */
export const draftable = (n: TocNode) => n.children.length === 0;
export const draftableIds = (toc: TocNode[]) => toc.flatMap((n) => (draftable(n) ? [n.id] : n.children.map((c) => c.id)));
export type SecStatus = '-' | '대기' | '진행중' | '취소대기' | '취소' | '완료' | '오류';
export interface Section { tocId: string; status: SecStatus; markdown: string; userEdited: boolean; sources: { filename: string; score: number; text: string }[]; history: { at: string; paraId: string; before: string; after: string; instruction: string }[]; origin?: string; provider?: string; references?: unknown[] }
export interface Plan { id: string; title: string; hazardType?: string; managementPhase?: string; createdBy: string; updatedBy?: string; createdAt: string; updatedAt: string; context: PlanContext | null; toc: TocNode[]; sections: Record<string, Section>; export?: { fileName: string; at: string; pages: number }; linkedExercises: string[] }
export interface PlanSummary { id: string; title: string; hazardType?: string; managementPhase?: string; createdBy: string; updatedBy?: string; createdAt: string; updatedAt: string; hasToc: boolean; drafted: number; total: number; exported: boolean; linkedExercises: string[] }

export type NodeType = 'START' | 'TASK' | 'DECISION' | 'DISPATCH' | 'FIELD_CHECK' | 'AUTO_LOG' | 'END';
export interface SopNode { id: string; type: NodeType; title: string; dept?: string; assignee?: string; priority?: string; due?: string; channels?: string[]; tasks?: string[]; logRules?: string[] }
export interface SopEdge { from: string; to: string; label?: string }
export interface SopGraph { nodes: SopNode[]; edges: SopEdge[]; sources: { filename: string; score: number; text: string }[]; mapperVersion: string; warnings: string[] }
export interface Sop { id: string; exerciseId: string; version: number; graph: SopGraph; createdAt: string }
export type TaskStatus = '대기' | '전파완료' | '수신확인' | '수행중' | '완료' | '지연' | '미완료' | '지원요청';
export interface Task { id: string; exerciseId: string; nodeId: string; seq: number; title: string; type: string; dept: string; assigneeId: string; assigneeName: string; due: string; priority: string; status: TaskStatus; instructions: string[]; message?: string; dispatchedAt?: string; ackedAt?: string; reportedAt?: string; memo?: string; receiptNo?: string; result?: string; exercise?: Exercise }
export interface Event { id: string; exerciseId: string; at: string; kind: string; content: string; dept?: string; actor?: string; status?: string; source: string; taskId?: string }
export interface Exercise { id: string; title: string; hazardType: string; phase: string; alertLevel: string; occurredAt: string; location: string; agency: string; dept: string; scenario: string; refData: string[]; options: string[]; status: 'DRAFT' | 'SOP_READY' | 'RUNNING' | 'CLOSED'; linkedPlanId: string | null; startedAt?: string; closedAt?: string; createdBy: string; analysis?: { suggestion: string; basis: string; at: string }; sop?: Sop | null; tasks?: Task[]; eventCount?: number; journal?: Journal | null; createdAt: string; updatedAt: string }
export interface Journal { id: string; exerciseId: string; sections: { key: string; title: string; kind: 'fact' | 'narrative'; markdown: string; aiGenerated: boolean; reviewed: boolean }[]; export?: { fileName: string; at: string; pages?: number; templateId?: string; templateName?: string } }
export interface Board { exercise: Exercise; elapsedMs: number; total: number; done: number; inProgress: number; delayed: number; waiting: number; dispatched: number; unacked: number; acked: number; reported: number; timeline: { kind: string; at: string | null }[]; active: Task[]; lastEventAt: string | null; autoLogged: number; aiCount: number; analysis: { suggestion: string; basis: string; at: string } | null }

export const HAZARDS = ['폭염', '태풍/호우', '지진', '황사', '산불', '감염병', '가축질병', '다중밀집건축물붕괴대형사고', '정부주요시설', '학교시설'];
export const fmtTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '-');
export const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '-');
/** 표용 짧은 일시 "2026-08-21 17:05" (toLocaleString은 "2026. 8. 21. 오후 5:05:39"로 길어 두 줄로 접힌다) */
export function fmtDT(iso: string): string { const d = new Date(iso); const z = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; }
/** "3분 전 수정"처럼 상대 시각. verb를 바꾸면 "3분 전 삭제" (휴지통) */
export function ago(iso: string, verb = '수정'): string {
  const d = (Date.now() - new Date(iso).getTime()) / 60000;
  if (d < 1) return `방금 ${verb}`; if (d < 60) return `${Math.floor(d)}분 전 ${verb}`; if (d < 1440) return `${Math.floor(d / 60)}시간 전 ${verb}`;
  const dt = new Date(iso); return `${dt.getMonth() + 1}월 ${dt.getDate()}일 ${verb}`;
}

// ── 날씨·기상특보 (server/src/weather.ts) ──
export interface Weather { source: 'kma-api' | 'open-meteo' | 'mock'; place: string; temp: number; condition: '맑음' | '구름조금' | '구름많음' | '흐림' | '비' | '눈' | '소나기' | '안개' | '천둥번개'; humidity?: number; windMs?: number; fetchedAt: string; error?: string }
export interface WarningItem { kind: string; level: '경보' | '주의보' | '기타'; regions: string }
export interface Warnings { source: 'kma-api' | 'weather.go.kr' | 'mock'; announcedAt: string; effectiveAt: string; active: WarningItem[]; preliminary: WarningItem[]; bulletins: { id: string; kind: '특보' | '정보' | '속보' | '기타'; no: string; time: string; title: string }[]; fetchedAt: string; error?: string }
/** 날씨 지역(환경설정 대신 브라우저 저장). 기본 서울 */
export const weatherPlace = () => localStorage.getItem('poc.weatherPlace') || '서울';
export const setWeatherPlace = (p: string) => localStorage.setItem('poc.weatherPlace', p);
export const WEATHER_ICON: Record<Weather['condition'], string> = { '맑음': 'sunny', '구름조금': 'cloudy', '구름많음': 'cloudy', '흐림': 'overcast', '비': 'rain', '눈': 'snow', '소나기': 'shower', '안개': 'fog', '천둥번개': 'thunder' };
