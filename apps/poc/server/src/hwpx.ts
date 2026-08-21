/**
 * rhwp(@rhwp/core WASM) 경계. 두 가지 일을 한다.
 *  1) 템플릿 HWPX → 스타일 프로파일 (개요 수준·글꼴·크기·개요번호)
 *  2) 마크다운 + 프로파일 → HWPX (템플릿 스타일 적용)
 * WASM은 프로세스에 한 번 초기화. HwpDocument는 요청마다 새로 만든다.
 * 주의: HwpViewer를 만든 뒤 같은 doc으로 export하면 null pointer — export 먼저.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
type Rhwp = typeof import('@rhwp/core');
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
}
export interface TemplateProfile {
  styles: { id: number; name: string }[];
  numbering: { id: number; levelFormats: string[]; startNumber: number }[];
  levels: LevelProfile[];
  bodyStyleId: number;
  bodyFontFamily: string | null;
  bodyFontSizePt: number | null;
  paragraphs: { idx: number; text: string; styleId: number; styleName: string; fontSizePt: number | null; bold: boolean; bullet: string; indentHu: number }[];
  fontsUsed: string[];
  pageCount: number;
  styleRuleText: string;
}

const BULLET_RE = /^\s*([□■○●◇◆ㅇo\-\-–—*·•▪▶►☞※]|\d+[.)]|[가-힣][.)]|\(\d+\)|[①-⑳])\s?/;

function detectBullet(text: string): string {
  const m = text.match(BULLET_RE);
  return m ? m[1] : '';
}

/** 글자 속성이 없는 문단(빈 문단)은 null. fontSize는 1/100pt. */
function charProps(doc: InstanceType<Rhwp['HwpDocument']>, para: number) {
  try {
    const raw = doc.getCharPropertiesAt(0, para, 0);
    if (!raw) return null;
    const cp = JSON.parse(raw) as { fontFamily?: string; fontSize?: number; bold?: boolean };
    return { fontFamily: cp.fontFamily ?? null, fontSizePt: cp.fontSize ? cp.fontSize / 100 : null, bold: !!cp.bold };
  } catch {
    return null;
  }
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

  // 개요 수준 추정: 1) '개요 N' 스타일이 실제 문단에 쓰였으면 그것 2) 아니면 기호+들여쓰기+크기로 서열
  const levels: LevelProfile[] = [];
  const outlineStyleUsed = paragraphs.filter((p) => /개요\s*\d/.test(p.styleName));
  if (outlineStyleUsed.length >= 2) {
    const byLevel = new Map<number, typeof paragraphs[number]>();
    for (const p of outlineStyleUsed) {
      const lv = Number(p.styleName.match(/(\d)/)?.[1] ?? 0);
      if (lv && !byLevel.has(lv)) byLevel.set(lv, p);
    }
    for (const [lv, p] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
      const cp = charProps(doc, p.idx);
      levels.push({ level: lv, styleId: p.styleId, styleName: p.styleName, bullet: p.bullet, fontFamily: cp?.fontFamily ?? null, fontSizePt: cp?.fontSizePt ?? null, bold: cp?.bold ?? false, indentHu: p.indentHu, sampleText: p.text.slice(0, 40) });
    }
  } else {
    // 기호가 있는 문단들을 (들여쓰기, -글자크기) 순으로 묶어 수준을 만든다
    const withBullet = paragraphs.filter((p) => p.bullet && p.text.trim().length > 1);
    const keyOf = (p: typeof paragraphs[number]) => `${p.bullet}|${p.indentHu}|${p.fontSizePt}`;
    const seen = new Map<string, typeof paragraphs[number]>();
    for (const p of withBullet) if (!seen.has(keyOf(p))) seen.set(keyOf(p), p);
    const ordered = [...seen.values()].sort((a, b) => a.indentHu - b.indentHu || (b.fontSizePt ?? 0) - (a.fontSizePt ?? 0));
    ordered.slice(0, 6).forEach((p, i) => {
      const cp = charProps(doc, p.idx);
      const outlineStyle = findStyle(new RegExp(`^개요\\s*${i + 1}$`));
      levels.push({ level: i + 1, styleId: outlineStyle, styleName: outlineStyle != null ? styleName.get(outlineStyle) ?? null : null, bullet: p.bullet, fontFamily: cp?.fontFamily ?? null, fontSizePt: cp?.fontSizePt ?? null, bold: cp?.bold ?? false, indentHu: p.indentHu, sampleText: p.text.slice(0, 40) });
    });
  }
  // 수준이 하나도 안 잡히면 스타일 목록의 개요1~3으로 최소 골격
  if (!levels.length) {
    for (let lv = 1; lv <= 3; lv++) {
      const sid = findStyle(new RegExp(`^개요\\s*${lv}$`));
      levels.push({ level: lv, styleId: sid, styleName: sid != null ? styleName.get(sid) ?? null : null, bullet: ['□', 'ㅇ', '-'][lv - 1], fontFamily: null, fontSizePt: [16, 15, 15][lv - 1], bold: lv === 1, indentHu: (lv - 1) * 800, sampleText: '' });
    }
  }

  const bodyPara = paragraphs.find((p) => !p.bullet && p.text.trim().length > 5 && p.styleId === bodyStyleId) ?? paragraphs.find((p) => p.text.trim().length > 5);
  const bodyCp = bodyPara ? charProps(doc, bodyPara.idx) : null;

  const styleRuleText = [
    '문서 스타일 규칙(템플릿에서 추출):',
    ...levels.map((l) => `- ${l.level}수준: 문단 앞에 "${l.bullet || '(없음)'}" 기호, ${l.fontFamily ?? '기본 글꼴'} ${l.fontSizePt ?? '?'}pt${l.bold ? ' 굵게' : ''}${l.indentHu ? `, 들여쓰기 ${Math.round(l.indentHu / 100)}` : ''}`),
    `- 본문: ${bodyCp?.fontFamily ?? '기본 글꼴'} ${bodyCp?.fontSizePt ?? '?'}pt`,
    numbering[0]?.levelFormats?.length ? `- 개요번호 형식: ${numbering[0].levelFormats.slice(0, 4).join(' / ')}` : '',
  ].filter(Boolean).join('\n');

  return {
    styles, numbering, levels, bodyStyleId,
    bodyFontFamily: bodyCp?.fontFamily ?? null, bodyFontSizePt: bodyCp?.fontSizePt ?? null,
    paragraphs, fontsUsed: info.fontsUsed ?? [], pageCount: info.pageCount ?? 1, styleRuleText,
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

/**
 * 템플릿 HWPX 위에 마크다운을 얹어 새 HWPX를 만든다.
 * - 템플릿 본문 문단은 전부 지우고(첫 문단만 남김) 그 자리에 채운다 → 용지·머리말·스타일 정의는 그대로 살아있다.
 * - heading level → profile.levels[level-1].styleId (없으면 본문), 기호는 텍스트 앞에 붙인다.
 * - 표는 createTable로 그리고 셀에 텍스트를 넣는다.
 */
export async function buildHwpx(templateBytes: Uint8Array, profile: TemplateProfile, title: string, md: string): Promise<Uint8Array> {
  const R = await initRhwp();
  const doc = new R.HwpDocument(templateBytes);
  // 본문 비우기: 뒤에서부터 삭제, 문단 0 하나 남김
  let count = doc.getParagraphCount(0);
  for (let i = count - 1; i >= 1; i--) doc.deleteParagraph(0, i);
  // 문단 0에 붙은 표·그림·머리말 컨트롤은 deleteText로 안 지워진다 — 구역/단 정의(용지 설정)만 남기고 제거 (실측)
  try {
    const ctrls = JSON.parse(doc.getControls()) as { userDesc: string; para: number; controlIndex: number; list?: number }[];
    for (const c of ctrls.filter((x) => x.para === 0 && !['구역 정의', '단 정의'].includes(x.userDesc)).sort((a, b) => b.controlIndex - a.controlIndex)) {
      try { doc.deleteControlAt(c.list ?? 0, c.para, c.controlIndex); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  const len0 = doc.getParagraphLength(0, 0);
  if (len0 > 0) doc.deleteText(0, 0, 0, len0);

  const blocks = parseMarkdown(md);
  const levelFor = (lv: number) => profile.levels.find((l) => l.level === lv) ?? profile.levels[Math.min(lv, profile.levels.length) - 1] ?? null;
  const applyLevel = (para: number, lv: number, sizeOverridePt?: number) => {
    const L = levelFor(lv);
    const styleId = L?.styleId ?? profile.bodyStyleId;
    try { doc.applyStyle(0, para, styleId); } catch { /* 스타일 없음 */ }
    const props: Record<string, unknown> = {};
    const size = sizeOverridePt ?? L?.fontSizePt;
    if (size) props.fontSize = Math.round(size * 100);
    if (L?.bold) props.bold = true;
    if (L?.fontFamily) props.fontFamily = L.fontFamily;
    if (Object.keys(props).length) {
      try { doc.applyCharFormat(0, para, 0, doc.getParagraphLength(0, para), JSON.stringify(props)); } catch { /* ignore */ }
    }
    // 새 문단은 직전 문단의 paraShape(정렬 포함)를 상속한다 — 제목의 center가 번지지 않게 명시한다
    try { doc.applyParaFormat(0, para, JSON.stringify({ alignment: 'justify', marginLeft: L?.indentHu ?? 0, indent: 0, spacingBefore: lv === 1 ? 600 : 200 })); } catch { /* ignore */ }
  };
  const applyBody = (para: number) => {
    try { doc.applyStyle(0, para, profile.bodyStyleId); } catch { /* ignore */ }
    try { doc.applyParaFormat(0, para, JSON.stringify({ alignment: 'justify', marginLeft: 0, indent: 0, spacingBefore: 0, spacingAfter: 200 })); } catch { /* ignore */ }
    const props: Record<string, unknown> = {};
    if (profile.bodyFontSizePt) props.fontSize = Math.round(profile.bodyFontSizePt * 100);
    if (profile.bodyFontFamily) props.fontFamily = profile.bodyFontFamily;
    if (Object.keys(props).length) {
      try { doc.applyCharFormat(0, para, 0, doc.getParagraphLength(0, para), JSON.stringify(props)); } catch { /* ignore */ }
    }
  };

  // 문단 0 = 제목. 이후 문단은 항상 끝에 append: insertParagraph(0, count)는 끝에 빈 문단을 만든다(실측).
  doc.insertText(0, 0, 0, title);
  applyLevel(0, 1, (levelFor(1)?.fontSizePt ?? 16) + 4);
  try { doc.applyParaFormat(0, 0, JSON.stringify({ alignment: 'center', marginLeft: 0, spacingBefore: 0, spacingAfter: 800 })); } catch { /* ignore */ }

  const appendPara = (text: string): number => {
    const idx = doc.getParagraphCount(0);
    doc.insertParagraph(0, idx);
    if (text) doc.insertText(0, idx, 0, text);
    return idx;
  };

  for (const b of blocks) {
    if (b.kind === 'heading') {
      const L = levelFor(b.level);
      const bullet = L?.bullet && !/^\d|^[가-힣][.)]/.test(stripInlineMd(b.text)) ? `${L.bullet} ` : '';
      const p = appendPara(`${bullet}${stripInlineMd(b.text)}`);
      applyLevel(p, b.level);
    } else if (b.kind === 'bullet') {
      const lv = Math.min(profile.levels.length, Math.max(2, b.level + 1));
      const L = levelFor(lv);
      const bullet = L?.bullet ? `${L.bullet} ` : '- ';
      const p = appendPara(`${bullet}${stripInlineMd(b.text)}`);
      applyLevel(p, lv);
    } else if (b.kind === 'para') {
      const p = appendPara(stripInlineMd(b.text));
      applyBody(p);
    } else if (b.kind === 'table' && b.rows?.length) {
      const rows = b.rows.length;
      const cols = Math.max(...b.rows.map((r) => r.length));
      const holder = appendPara('');
      applyBody(holder);
      let ok = false;
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
      if (!ok) for (const r of b.rows) { const p = appendPara(r.join(' | ')); applyBody(p); }
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
