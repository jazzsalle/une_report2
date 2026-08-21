/**
 * rhwp(@rhwp/core WASM) 경계. 두 가지 일을 한다.
 *  1) 템플릿 HWPX → 스타일 프로파일 (개요 수준·글꼴·크기·개요번호 + 글자모양/문단모양 ID + 견본 구간)
 *  2) 마크다운 + 프로파일 → HWPX (템플릿 견본 구간만 본문으로 교체, 나머지는 보존)
 * WASM은 프로세스에 한 번 초기화. HwpDocument는 요청마다 새로 만든다.
 * 주의: HwpViewer를 만든 뒤 같은 doc으로 export하면 null pointer — export 먼저.
 *
 * 실측 2026-08-21 (rhwp 0.8.4, templete/간략 보고 양식.hwpx):
 *  - applyCharFormat의 fontFamily/fontFamilies는 ok를 돌려주지만 글꼴이 바뀌지 않는다. fontSize·bold만 먹는다.
 *    → 글꼴은 견본 문단의 charShapeId를 setCharShapeId로 복사해야 살아난다(이후 insertText한 글자도 그 모양을 잇는다).
 *  - applyStyle(개요 N)은 글자 모양을 바꾸지 않는다(견본이 '바탕글'에 직접 서식을 준 템플릿이 많다).
 *  - insertParagraph(0, i)는 i 앞에 빈 문단을 끼운다(기존 i는 i+1로). count를 주면 끝에 붙는다.
 *  - 제목 상자·"긴급/보고/공유" 같은 머리 영역은 문단 0의 표 컨트롤이다. 셀 텍스트는 getTextInCell/deleteTextInCell/insertTextInCell.
 *  - 견본 문단의 들여쓰기는 스타일이 아니라 앞쪽 공백 문자(" ㅇ", "   - ")인 템플릿이 많다 → prefix로 그대로 가져온다.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
type Rhwp = typeof import('@rhwp/core');
type Doc = InstanceType<Rhwp['HwpDocument']>;
let rhwp: Rhwp | null = null;

export async function initRhwp(): Promise<Rhwp> {
  if (rhwp) return rhwp;
  const mod = (await import('@rhwp/core')) as Rhwp & { default: (o: { module_or_path: Uint8Array }) => Promise<unknown> };
  const wasmPath = join(dirname(require.resolve('@rhwp/core/package.json')), 'rhwp_bg.wasm');
  await mod.default({ module_or_path: readFileSync(wasmPath) });
  rhwp = mod;
  return mod;
}

export function rhwpVersion(): string {
  return rhwp ? rhwp.version() : '(미초기화)';
}

// ── 프로파일 ─────────────────────────────────────────────────────────────

export interface LevelProfile {
  level: number;
  styleId: number | null;
  styleName: string | null;
  bullet: string;
  fontFamily: string | null;
  fontSizePt: number | null;
  bold: boolean;
  indentHu: number;
  sampleText: string;
  /** 견본 문단의 글자모양/문단모양 ID와 앞쪽 공백 — 내보내기 때 그대로 복사한다 (2026-08-21 추가, 이전 프로파일엔 없음) */
  charShapeId?: number | null;
  paraShapeId?: number | null;
  prefix?: string;
}
export interface TemplateLayout {
  /** 견본 구간 [sampleStart, sampleEnd] — 이 문단들을 지우고 본문을 넣는다. 앞은 머리 영역(제목 표 등), 뒤는 꼬리 영역(보고경로 표 등)으로 보존 */
  sampleStart: number;
  sampleEnd: number;
  tableParas: number[];
}
export interface TemplateProfile {
  styles: { id: number; name: string }[];
  numbering: { id: number; levelFormats: string[]; startNumber: number }[];
  levels: LevelProfile[];
  bodyStyleId: number;
  bodyFontFamily: string | null;
  bodyFontSizePt: number | null;
  bodyCharShapeId?: number | null;
  bodyParaShapeId?: number | null;
  paragraphs: { idx: number; text: string; styleId: number; styleName: string; fontSizePt: number | null; bold: boolean; bullet: string; indentHu: number }[];
  fontsUsed: string[];
  pageCount: number;
  styleRuleText: string;
  layout?: TemplateLayout;
}

const BULLET_RE = /^\s*([□■○●◇◆ㅇo\-\-–—*·•▪▶►☞※]|\d+[.)]|[가-힣][.)]|\(\d+\)|[①-⑳])\s?/;

function detectBullet(text: string): string {
  const m = text.match(BULLET_RE);
  return m ? m[1] : '';
}
/** "1." "가." "(1)" "①" 같은 번호형 기호인가 — 본문 제목이 이미 번호로 시작하면 중복해서 붙이지 않는다 */
const isNumberingBullet = (b: string) => /^(\d+[.)]|[가-힣][.)]|\(\d+\)|[①-⑳])$/.test(b);

/** 글자 속성이 없는 문단(빈 문단)은 null. fontSize는 1/100pt. */
function charProps(doc: Doc, para: number) {
  try {
    const raw = doc.getCharPropertiesAt(0, para, 0);
    if (!raw) return null;
    const cp = JSON.parse(raw) as { fontFamily?: string; fontSize?: number; bold?: boolean; charShapeId?: number };
    return { fontFamily: cp.fontFamily ?? null, fontSizePt: cp.fontSize ? cp.fontSize / 100 : null, bold: !!cp.bold, charShapeId: cp.charShapeId ?? null };
  } catch {
    return null;
  }
}
function paraShapeIdOf(doc: Doc, para: number): number | null {
  try { const pp = JSON.parse(doc.getParaPropertiesAt(0, para)) as { paraShapeId?: number }; return pp.paraShapeId ?? null; } catch { return null; }
}
function tableParasOf(doc: Doc): number[] {
  try {
    const ctrls = JSON.parse(doc.getControls()) as { userDesc: string; para: number; list?: number }[];
    return [...new Set(ctrls.filter((c) => c.userDesc === '표' && (c.list ?? 0) === 0).map((c) => c.para))].sort((a, b) => a - b);
  } catch { return []; }
}

export async function profileTemplate(bytes: Uint8Array): Promise<TemplateProfile> {
  const R = await initRhwp();
  const doc = new R.HwpDocument(bytes);
  const styles = (JSON.parse(doc.getStyleList()) as { id: number; name: string }[]).map((s) => ({ id: s.id, name: s.name }));
  const numbering = JSON.parse(doc.getNumberingList()) as TemplateProfile['numbering'];
  const info = JSON.parse(doc.getDocumentInfo()) as { fontsUsed?: string[]; pageCount?: number };
  const styleName = new Map(styles.map((s) => [s.id, s.name]));
  const findStyle = (re: RegExp) => styles.find((s) => re.test(s.name))?.id ?? null;
  const bodyStyleId = findStyle(/^본문$/) ?? findStyle(/^바탕글$/) ?? styles[0]?.id ?? 0;

  const n = doc.getParagraphCount(0);
  const paragraphs: TemplateProfile['paragraphs'] = [];
  for (let i = 0; i < n; i++) {
    const len = doc.getParagraphLength(0, i);
    const text = len > 0 ? doc.getTextRange(0, i, 0, len) : '';
    let styleId = bodyStyleId;
    try {
      const s = JSON.parse(doc.getStyleAt(0, i)) as { id?: number };
      if (typeof s.id === 'number') styleId = s.id;
    } catch {
      /* 스타일 없는 문단 */
    }
    let indentHu = 0;
    try {
      const pp = JSON.parse(doc.getParaPropertiesAt(0, i)) as { indent?: number; marginLeft?: number };
      indentHu = (pp.marginLeft ?? 0) + Math.max(0, pp.indent ?? 0);
    } catch {
      /* ignore */
    }
    const cp = len > 0 ? charProps(doc, i) : null;
    paragraphs.push({ idx: i, text, styleId, styleName: styleName.get(styleId) ?? '', fontSizePt: cp?.fontSizePt ?? null, bold: cp?.bold ?? false, bullet: detectBullet(text), indentHu });
  }
  const levelOf = (p: typeof paragraphs[number], lv: number, styleId: number | null, name: string | null): LevelProfile => {
    const cp = charProps(doc, p.idx);
    return { level: lv, styleId, styleName: name, bullet: p.bullet, fontFamily: cp?.fontFamily ?? null, fontSizePt: cp?.fontSizePt ?? null, bold: cp?.bold ?? false, indentHu: p.indentHu, sampleText: p.text.slice(0, 40), charShapeId: cp?.charShapeId ?? null, paraShapeId: paraShapeIdOf(doc, p.idx), prefix: p.text.match(/^\s*/)?.[0] ?? '' };
  };

  // 개요 수준 추정: 1) '개요 N' 스타일이 실제 문단에 쓰였으면 그것 2) 아니면 기호+들여쓰기+크기로 서열
  const levels: LevelProfile[] = [];
  const outlineStyleUsed = paragraphs.filter((p) => /개요\s*\d/.test(p.styleName));
  if (outlineStyleUsed.length >= 2) {
    const byLevel = new Map<number, typeof paragraphs[number]>();
    for (const p of outlineStyleUsed) {
      const lv = Number(p.styleName.match(/(\d)/)?.[1] ?? 0);
      if (lv && !byLevel.has(lv)) byLevel.set(lv, p);
    }
    for (const [lv, p] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) levels.push(levelOf(p, lv, p.styleId, p.styleName));
  } else {
    // 기호가 있는 문단들을 (들여쓰기, -글자크기) 순으로 묶어 수준을 만든다
    const withBullet = paragraphs.filter((p) => p.bullet && p.text.trim().length > 1);
    const keyOf = (p: typeof paragraphs[number]) => `${p.bullet}|${p.indentHu}|${p.fontSizePt}`;
    const seen = new Map<string, typeof paragraphs[number]>();
    for (const p of withBullet) if (!seen.has(keyOf(p))) seen.set(keyOf(p), p);
    const ordered = [...seen.values()].sort((a, b) => a.indentHu - b.indentHu || (b.fontSizePt ?? 0) - (a.fontSizePt ?? 0));
    ordered.slice(0, 6).forEach((p, i) => {
      const outlineStyle = findStyle(new RegExp(`^개요\\s*${i + 1}$`));
      levels.push(levelOf(p, i + 1, outlineStyle, outlineStyle != null ? styleName.get(outlineStyle) ?? null : null));
    });
  }
  // 수준이 하나도 안 잡히면 스타일 목록의 개요1~3으로 최소 골격
  if (!levels.length) {
    for (let lv = 1; lv <= 3; lv++) {
      const sid = findStyle(new RegExp(`^개요\\s*${lv}$`));
      levels.push({ level: lv, styleId: sid, styleName: sid != null ? styleName.get(sid) ?? null : null, bullet: ['□', 'ㅇ', '-'][lv - 1], fontFamily: null, fontSizePt: [16, 15, 15][lv - 1], bold: lv === 1, indentHu: (lv - 1) * 800, sampleText: '', charShapeId: null, paraShapeId: null, prefix: '' });
    }
  }

  const bodyPara = paragraphs.find((p) => !p.bullet && p.text.trim().length > 5 && p.styleId === bodyStyleId) ?? paragraphs.find((p) => p.text.trim().length > 5);
  const bodyCp = bodyPara ? charProps(doc, bodyPara.idx) : null;

  // 견본 구간: 첫 기호 문단부터 마지막 견본 요소(기호 문단, "< 표 제목 >", 그 다음 표)까지
  const levelBullets = new Set(levels.map((l) => l.bullet).filter(Boolean));
  const tableParas = tableParasOf(doc);
  const bulletParas = paragraphs.filter((p) => levelBullets.has(p.bullet) && p.text.trim().length > 1).map((p) => p.idx);
  let layout: TemplateLayout | undefined;
  if (bulletParas.length) {
    const sampleStart = Math.min(...bulletParas);
    let sampleEnd = Math.max(...bulletParas);
    for (const p of paragraphs) {
      if (p.idx > sampleStart && /표\s*제목/.test(p.text)) {
        sampleEnd = Math.max(sampleEnd, p.idx);
        const nextTable = tableParas.find((t) => t > p.idx);
        if (nextTable != null && nextTable - p.idx <= 3) sampleEnd = Math.max(sampleEnd, nextTable);
      }
    }
    layout = { sampleStart, sampleEnd, tableParas };
  }

  const styleRuleText = [
    '문서 스타일 규칙(템플릿에서 추출):',
    ...levels.map((l) => `- ${l.level}수준: 문단 앞에 "${l.bullet || '(없음)'}" 기호, ${l.fontFamily ?? '기본 글꼴'} ${l.fontSizePt ?? '?'}pt${l.bold ? ' 굵게' : ''}${l.indentHu ? `, 들여쓰기 ${Math.round(l.indentHu / 100)}` : ''}`),
    `- 본문: ${bodyCp?.fontFamily ?? '기본 글꼴'} ${bodyCp?.fontSizePt ?? '?'}pt`,
    numbering[0]?.levelFormats?.length ? `- 개요번호 형식: ${numbering[0].levelFormats.slice(0, 4).join(' / ')}` : '',
  ].filter(Boolean).join('\n');

  return {
    styles, numbering, levels, bodyStyleId,
    bodyFontFamily: bodyCp?.fontFamily ?? null, bodyFontSizePt: bodyCp?.fontSizePt ?? null,
    bodyCharShapeId: bodyCp?.charShapeId ?? null, bodyParaShapeId: bodyPara ? paraShapeIdOf(doc, bodyPara.idx) : null,
    paragraphs, fontsUsed: info.fontsUsed ?? [], pageCount: info.pageCount ?? 1, styleRuleText, layout,
  };
}

// ── 마크다운 → HWPX ───────────────────────────────────────────────────────

export interface MdBlock {
  kind: 'heading' | 'para' | 'bullet' | 'table' | 'blank';
  level: number;         // heading 1..6, bullet depth 1..
  text: string;
  rows?: string[][];     // table
}

/** 아주 작은 마크다운 블록 파서 — heading, 불릿, 표, 문단. */
export function parseMarkdown(md: string): MdBlock[] {
  const lines = md.replace(/\r/g, '').replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?|```/g, '')).split('\n');
  const blocks: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { blocks.push({ kind: 'heading', level: h[1].length, text: h[2].trim() }); i++; continue; }
    if (/^\s*\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      blocks.push({ kind: 'table', level: 0, text: '', rows });
      continue;
    }
    const b = line.match(/^(\s*)([-*•·ㅇ□■○●◇◆]|\d+[.)])\s+(.*)$/);
    if (b) {
      const depth = Math.floor(b[1].replace(/\t/g, '  ').length / 2) + 1;
      blocks.push({ kind: 'bullet', level: depth, text: b[3].trim() });
      i++;
      continue;
    }
    // 문단: 다음 빈 줄까지 이어붙임
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s/.test(lines[i]) && !/^\s*\|/.test(lines[i]) && !/^\s*([-*•·ㅇ□■○●◇◆]|\d+[.)])\s/.test(lines[i])) {
      buf.push(lines[i].trim());
      i++;
    }
    if (buf.length) blocks.push({ kind: 'para', level: 0, text: buf.join(' ') });
    else i++;
  }
  return blocks;
}

function stripInlineMd(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/`(.+?)`/g, '$1').replace(/\[(.+?)\]\(.+?\)/g, '$1');
}

export interface BuildMeta { reportedAt?: string; reporter?: string }
const fmtKoDate = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return iso;
  const hm = /T\d{2}:\d{2}/.test(iso) ? ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.${hm}`;
};

/**
 * 템플릿 HWPX 위에 마크다운을 얹어 새 HWPX를 만든다.
 * - 프로파일의 견본 구간(layout)이 있으면: 머리 영역(제목 표·보고일시 줄)과 꼬리 영역(보고경로 표 등)은 두고 견본 문단만 지운 자리에 본문을 끼운다.
 *   머리 영역 표의 "제목" 칸은 문서명으로, "보고일시" 줄은 meta로 바꾼다.
 * - 견본 구간 정보가 없으면(예전 프로파일/기호 없는 템플릿): 문단 0을 제목으로 쓰고 나머지를 비운 뒤 본문을 붙인다.
 * - heading level → 해당 수준 견본의 글자모양·문단모양 ID 복사 + (앞공백)+기호. 표는 createTable.
 */
export async function buildHwpx(templateBytes: Uint8Array, profile: TemplateProfile, title: string, md: string, meta: BuildMeta = {}): Promise<Uint8Array> {
  const R = await initRhwp();
  // 예전에 저장된 프로파일에는 글자모양 ID·견본 구간이 없다 → 템플릿에서 다시 읽는다
  const P = profile.levels.some((l) => l.charShapeId != null) ? profile : await profileTemplate(templateBytes);
  const doc = new R.HwpDocument(templateBytes);

  const levelFor = (lv: number) => P.levels.find((l) => l.level === lv) ?? P.levels[Math.min(lv, P.levels.length) - 1] ?? null;
  const len = (para: number) => doc.getParagraphLength(0, para);
  const applyLevel = (para: number, lv: number, sizeOverridePt?: number) => {
    const L = levelFor(lv);
    if (L?.styleId != null) { try { doc.applyStyle(0, para, L.styleId); } catch { /* 스타일 없음 */ } }
    if (L?.paraShapeId != null) { try { doc.setParaShapeId(0, para, L.paraShapeId); } catch { /* ignore */ } }
    else { try { doc.applyParaFormat(0, para, JSON.stringify({ alignment: 'justify', marginLeft: L?.indentHu ?? 0, indent: 0, spacingBefore: lv === 1 ? 600 : 200 })); } catch { /* ignore */ } }
    if (L?.charShapeId != null) { try { doc.setCharShapeId(0, para, 0, len(para), L.charShapeId); } catch { /* ignore */ } }
    else {
      const props: Record<string, unknown> = {};
      if (L?.fontSizePt) props.fontSize = Math.round(L.fontSizePt * 100);
      if (L?.bold) props.bold = true;
      if (Object.keys(props).length) { try { doc.applyCharFormat(0, para, 0, len(para), JSON.stringify(props)); } catch { /* ignore */ } }
    }
    if (sizeOverridePt) { try { doc.applyCharFormat(0, para, 0, len(para), JSON.stringify({ fontSize: Math.round(sizeOverridePt * 100), bold: true })); } catch { /* ignore */ } }
  };
  const applyBody = (para: number) => {
    try { doc.applyStyle(0, para, P.bodyStyleId); } catch { /* ignore */ }
    if (P.bodyParaShapeId != null) { try { doc.setParaShapeId(0, para, P.bodyParaShapeId); } catch { /* ignore */ } }
    else { try { doc.applyParaFormat(0, para, JSON.stringify({ alignment: 'justify', marginLeft: 0, indent: 0, spacingBefore: 0, spacingAfter: 200 })); } catch { /* ignore */ } }
    if (P.bodyCharShapeId != null) { try { doc.setCharShapeId(0, para, 0, len(para), P.bodyCharShapeId); } catch { /* ignore */ } }
    else if (P.bodyFontSizePt) { try { doc.applyCharFormat(0, para, 0, len(para), JSON.stringify({ fontSize: Math.round(P.bodyFontSizePt * 100) })); } catch { /* ignore */ } }
  };
  const bulletText = (L: LevelProfile | null, text: string) => {
    const b = L?.bullet ?? '';
    const skip = !b || text.startsWith(b) || (isNumberingBullet(b) && /^(\d|[가-힣][.)])/.test(text));
    return `${L?.prefix ?? ''}${skip ? '' : `${b} `}${text}`;
  };
  /** "**(소제목)** 문장" 관례 — 마크다운 굵게는 벗겨지므로 (소제목) 구간만 굵게 다시 건다 */
  const boldSubtitle = (para: number, raw: string) => {
    const m = raw.match(/^\*\*(\([^)]{1,30}\))\*\*/);
    if (!m) return;
    const full = len(para); const plain = doc.getTextRange(0, para, 0, full);
    const start = plain.indexOf(m[1]); if (start < 0) return;
    try { doc.applyCharFormat(0, para, start, start + m[1].length, JSON.stringify({ bold: true })); } catch { /* ignore */ }
  };

  // ── 1) 템플릿 정리: 견본 구간을 비우고 삽입 위치(cursor)를 정한다 ──
  let cursor: number;
  let titlePlaced = false;
  const layout = P.layout;
  if (layout && layout.sampleStart > 0) {
    // 머리 영역의 표에서 "제목" 칸을 찾아 문서명으로 교체
    try {
      const ctrls = JSON.parse(doc.getControls()) as { userDesc: string; para: number; controlIndex: number; list?: number }[];
      outer: for (const c of ctrls.filter((x) => x.userDesc === '표' && (x.list ?? 0) === 0 && x.para < layout.sampleStart)) {
        for (let cell = 0; cell < 64; cell++) {
          let cellLen: number;
          try { cellLen = doc.getCellParagraphLength(0, c.para, c.controlIndex, cell, 0); } catch { break; }
          const text = cellLen > 0 ? doc.getTextInCell(0, c.para, c.controlIndex, cell, 0, 0, cellLen) : '';
          if (!/제\s*목/.test(text)) continue;
          let cs: number | null = null;
          try { cs = (JSON.parse(doc.getCellCharPropertiesAt(0, c.para, c.controlIndex, cell, 0, 0)) as { charShapeId?: number }).charShapeId ?? null; } catch { /* ignore */ }
          doc.deleteTextInCell(0, c.para, c.controlIndex, cell, 0, 0, cellLen);
          doc.insertTextInCell(0, c.para, c.controlIndex, cell, 0, 0, title);
          if (cs != null) { try { doc.setCharShapeIdInCell(0, c.para, c.controlIndex, cell, 0, 0, title.length, cs); } catch { /* ignore */ } }
          titlePlaced = true;
          break outer;
        }
      }
    } catch { /* 표 없음 */ }
    // 머리 영역의 "(보고일시, 보고자 …)" 줄을 채운다
    for (let i = 0; i < layout.sampleStart; i++) {
      const l = len(i); if (!l) continue;
      const text = doc.getTextRange(0, i, 0, l);
      if (!/보고일시/.test(text)) continue;
      const cs = charProps(doc, i)?.charShapeId ?? null;
      const parts = [meta.reportedAt ? `보고일시 ${fmtKoDate(meta.reportedAt)}` : '보고일시', meta.reporter ? `보고자 ${meta.reporter}` : '보고자'];
      doc.deleteText(0, i, 0, l);
      doc.insertText(0, i, 0, `(${parts.join(', ')})`);
      if (cs != null) { try { doc.setCharShapeId(0, i, 0, len(i), cs); } catch { /* ignore */ } }
      break;
    }
    // 견본 구간 삭제 (뒤에서부터)
    const end = Math.min(layout.sampleEnd, doc.getParagraphCount(0) - 1);
    for (let i = end; i >= layout.sampleStart; i--) doc.deleteParagraph(0, i);
    // 꼬리 영역 앞의 빈 문단은 하나만 남긴다
    while (doc.getParagraphCount(0) > layout.sampleStart + 1 && len(layout.sampleStart) === 0 && len(layout.sampleStart + 1) === 0) doc.deleteParagraph(0, layout.sampleStart);
    cursor = layout.sampleStart;
  } else {
    // 견본 구간 정보 없음: 문단 0을 제목으로, 나머지는 모두 비운다
    const count = doc.getParagraphCount(0);
    for (let i = count - 1; i >= 1; i--) doc.deleteParagraph(0, i);
    // 문단 0에 붙은 표·그림·머리말 컨트롤은 deleteText로 안 지워진다 — 구역/단 정의(용지 설정)만 남기고 제거 (실측)
    try {
      const ctrls = JSON.parse(doc.getControls()) as { userDesc: string; para: number; controlIndex: number; list?: number }[];
      for (const c of ctrls.filter((x) => x.para === 0 && !['구역 정의', '단 정의'].includes(x.userDesc)).sort((a, b) => b.controlIndex - a.controlIndex)) {
        try { doc.deleteControlAt(c.list ?? 0, c.para, c.controlIndex); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    const len0 = len(0);
    if (len0 > 0) doc.deleteText(0, 0, 0, len0);
    doc.insertText(0, 0, 0, title);
    applyLevel(0, 1, (levelFor(1)?.fontSizePt ?? 16) + 4);
    try { doc.applyParaFormat(0, 0, JSON.stringify({ alignment: 'center', marginLeft: 0, spacingBefore: 0, spacingAfter: 800 })); } catch { /* ignore */ }
    titlePlaced = true;
    cursor = 1;
  }

  // ── 2) 본문 삽입: cursor 앞에 끼워 넣고 cursor를 전진 ──
  const insertAt = (text: string): number => {
    const idx = cursor;
    doc.insertParagraph(0, idx);
    if (text) doc.insertText(0, idx, 0, text);
    cursor++;
    return idx;
  };
  if (!titlePlaced) {
    const p = insertAt(title);
    applyLevel(p, 1, (levelFor(1)?.fontSizePt ?? 16) + 4);
    try { doc.applyParaFormat(0, p, JSON.stringify({ alignment: 'center', marginLeft: 0, spacingBefore: 0, spacingAfter: 800 })); } catch { /* ignore */ }
  }

  for (const b of parseMarkdown(md)) {
    if (b.kind === 'heading') {
      const p = insertAt(bulletText(levelFor(b.level), stripInlineMd(b.text)));
      applyLevel(p, b.level);
    } else if (b.kind === 'bullet') {
      const lv = Math.min(P.levels.length, Math.max(2, b.level + 1));
      const L = levelFor(lv);
      const p = insertAt(L ? bulletText(L, stripInlineMd(b.text)) : `- ${stripInlineMd(b.text)}`);
      applyLevel(p, lv);
      boldSubtitle(p, b.text);
    } else if (b.kind === 'para') {
      const p = insertAt(stripInlineMd(b.text));
      applyBody(p);
      boldSubtitle(p, b.text);
    } else if (b.kind === 'table' && b.rows?.length) {
      const rows = b.rows.length;
      const cols = Math.max(...b.rows.map((r) => r.length));
      const holder = insertAt('');
      applyBody(holder);
      let ok = false;
      const before = doc.getParagraphCount(0);
      try {
        const res = JSON.parse(doc.createTable(0, holder, 0, rows, cols)) as { ok?: boolean; paraIdx?: number; controlIdx?: number };
        if (res.ok) {
          const tblPara = res.paraIdx ?? holder;
          const ctrl = res.controlIdx ?? 0;
          b.rows.forEach((r, ri) => r.forEach((cell, ci) => {
            try { doc.insertTextInCell(0, tblPara, ctrl, ri * cols + ci, 0, 0, stripInlineMd(cell)); } catch { /* 셀 실패 무시 */ }
          }));
          ok = true;
        }
      } catch { /* fallthrough */ }
      cursor += doc.getParagraphCount(0) - before; // 표 생성이 문단을 늘렸으면 그만큼 전진
      if (!ok) for (const r of b.rows) { const p = insertAt(r.join(' | ')); applyBody(p); }
    }
  }
  return doc.exportHwpx();
}

/** HWPX → 페이지 HTML 배열 (미리보기). 별도 doc으로 연다. */
export async function renderHwpxHtml(bytes: Uint8Array, maxPages = 20): Promise<{ pages: number; htmls: string[] }> {
  const R = await initRhwp();
  const doc = new R.HwpDocument(bytes);
  const viewer = new R.HwpViewer(doc);
  const pages = viewer.pageCount();
  const htmls: string[] = [];
  for (let i = 0; i < Math.min(pages, maxPages); i++) htmls.push(viewer.renderPageHtml(i));
  return { pages, htmls };
}

/** HWPX → 문단 텍스트 목록(재수입용). */
export async function extractParagraphs(bytes: Uint8Array): Promise<string[]> {
  const R = await initRhwp();
  const doc = new R.HwpDocument(bytes);
  const n = doc.getParagraphCount(0);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const len = doc.getParagraphLength(0, i);
    out.push(len > 0 ? doc.getTextRange(0, i, 0, len) : '');
  }
  return out;
}
