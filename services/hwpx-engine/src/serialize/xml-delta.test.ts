import { resolve } from 'node:path';
import type { BlockIR, DocumentIR, ParagraphIR } from '@une/domain';
import { describe, expect, it } from 'vitest';
import { HwpxEngine } from '../contract';
import { readZipArchive } from '../package/zip-reader';
import { loadCorpus, readCorpusFile, type CorpusFile } from '../testing/corpus';
import { HwpxExportError } from './errors';
import { applySplices, buildXmlDelta, escapeXmlText } from './xml-delta';
import { rewriteArchive } from './zip-writer';

const REPO_ROOT = resolve(__dirname, '../../../..');
const corpus = loadCorpus(REPO_ROOT);
const engine = new HwpxEngine();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function partBytesOf(bytes: Uint8Array): Map<string, Uint8Array> {
  const archive = readZipArchive(bytes);
  return new Map(archive.entries.map((entry) => [entry.path, entry.bytes]));
}

function eachParagraph(blocks: readonly BlockIR[], visit: (p: ParagraphIR) => void): void {
  for (const block of blocks) {
    if (block.kind === 'PARAGRAPH') visit(block);
    else if (block.kind === 'TABLE') {
      for (const row of block.rows) for (const cell of row.cells) eachParagraph(cell.blocks, visit);
    }
  }
}

/**
 * 되쓰기가 실제로 가능한 문단을 찾는다.
 *
 * IR만 보고는 판정할 수 없다 — `[hp:t, hp:ctrl, hp:ctrl, hp:t]`처럼 누름틀
 * 필드로 갈라진 run은 IR에서 단일 run·controls 0으로 보이지만 되쓸 자리가
 * 유일하지 않아 엔진이 (옳게) 거부한다. 그래서 후보를 실제로 되쓰기에
 * 넣어 보고 통과하는 첫 문단을 고른다. 이 헬퍼가 하나도 못 찾으면 그것은
 * "이 문서에는 편집 가능한 문단이 없다"는 뜻이고, 그 자체가 실패다.
 */
function findEditableParagraph(
  ir: DocumentIR,
  partBytes: ReadonlyMap<string, Uint8Array>,
  newText: string,
): { sectionIndex: number; paragraphId: string; editedIr: DocumentIR } {
  for (let sectionIndex = 0; sectionIndex < ir.sections.length; sectionIndex += 1) {
    const candidates: ParagraphIR[] = [];
    eachParagraph(ir.sections[sectionIndex].blocks, (paragraph) => {
      if (paragraph.runs.length !== 1) return;
      if (paragraph.runs[0].text.trim().length === 0) return;
      candidates.push(paragraph);
    });

    for (const candidate of candidates) {
      const editedIr = clone(ir);
      eachParagraph(editedIr.sections[sectionIndex].blocks, (paragraph) => {
        if (paragraph.paragraphId === candidate.paragraphId) paragraph.runs[0].text = newText;
      });
      try {
        buildXmlDelta({ baseIr: ir, editedIr, partBytes });
      } catch (error) {
        if (error instanceof HwpxExportError) continue;
        throw error;
      }
      return { sectionIndex, paragraphId: candidate.paragraphId, editedIr };
    }
  }
  throw new Error('되쓰기 가능한 문단이 없습니다');
}

interface Prepared {
  readonly file: CorpusFile;
  readonly bytes: Uint8Array;
  readonly ir: DocumentIR;
  readonly partBytes: Map<string, Uint8Array>;
}

function prepare(file: CorpusFile): Prepared {
  const bytes = readCorpusFile(file);
  const analysis = engine.analyzeDocument({ bytes, fileName: file.alias });
  return { file, bytes, ir: analysis.ir, partBytes: partBytesOf(bytes) };
}

describe('XML Delta Writer — 편집 없음', () => {
  for (const file of corpus.files) {
    it(`${file.alias}: 편집이 없으면 되쓰기 계획이 비어 있다`, () => {
      const { ir, partBytes } = prepare(file);
      const delta = buildXmlDelta({ baseIr: ir, editedIr: clone(ir), partBytes });
      expect(delta.spliceCount).toBe(0);
      expect(delta.replacements.size).toBe(0);
    });
  }
});

describe('XML Delta Writer — 텍스트 되쓰기', () => {
  for (const file of corpus.files) {
    it(`${file.alias}: 문단 텍스트를 바꾸면 그 Part만 바뀌고 다른 Part는 바이트 그대로다`, () => {
      const { bytes, ir, partBytes } = prepare(file);
      const { sectionIndex, editedIr } = findEditableParagraph(ir, partBytes, 'UNE 되쓰기 검증');

      const delta = buildXmlDelta({ baseIr: ir, editedIr, partBytes });
      expect(delta.spliceCount).toBe(1);
      const changedPart = editedIr.sections[sectionIndex].partPath;
      expect([...delta.replacements.keys()]).toEqual([changedPart]);

      // 패키지로 다시 써서, 손대지 않은 엔트리가 **저장 바이트까지** 같은지 본다.
      const original = readZipArchive(bytes);
      const result = rewriteArchive(original, delta.replacements);
      const rewritten = readZipArchive(result.bytes);
      for (const entry of original.entries) {
        const after = rewritten.byPath.get(entry.path)!;
        if (entry.path === changedPart) expect(after.sha256).not.toBe(entry.sha256);
        else expect(after.storedSha256, entry.path).toBe(entry.storedSha256);
      }

      // 다시 분석했을 때 새 텍스트가 실제로 보인다(되쓰기가 반영됐다).
      const reanalyzed = engine.analyzeDocument({ bytes: result.bytes, fileName: 'rewritten' });
      let seen = false;
      for (const section of reanalyzed.ir.sections) {
        eachParagraph(section.blocks, (candidate) => {
          if (candidate.runs.some((run) => run.text.includes('UNE 되쓰기 검증'))) seen = true;
        });
      }
      expect(seen).toBe(true);
    });
  }

  it('XML 특수문자는 이스케이프되어 well-formed를 유지한다', () => {
    const { bytes, ir, partBytes } = prepare(corpus.files[0]);
    const { editedIr } = findEditableParagraph(ir, partBytes, 'a < b & c > d');

    const delta = buildXmlDelta({ baseIr: ir, editedIr, partBytes });
    const result = rewriteArchive(readZipArchive(bytes), delta.replacements);
    // 재분석이 성공한다 = XML이 깨지지 않았다.
    const reanalyzed = engine.analyzeDocument({ bytes: result.bytes, fileName: 'escaped' });
    let seen = false;
    for (const section of reanalyzed.ir.sections) {
      eachParagraph(section.blocks, (candidate) => {
        if (candidate.runs.some((run) => run.text.includes('a < b & c > d'))) seen = true;
      });
    }
    expect(seen).toBe(true);
  });
});

describe('XML Delta Writer — 거부해야 하는 것', () => {
  it('run 개수가 달라지면 HWPX-1103으로 거부한다 (추측해서 쓰지 않는다)', () => {
    const { ir, partBytes } = prepare(corpus.files[0]);
    const { sectionIndex, paragraphId, editedIr } = findEditableParagraph(ir, partBytes, '변경');
    eachParagraph(editedIr.sections[sectionIndex].blocks, (candidate) => {
      if (candidate.paragraphId === paragraphId) {
        candidate.runs.push({ ...candidate.runs[0], runId: 'R-extra', text: '추가' });
      }
    });
    expect(() => buildXmlDelta({ baseIr: ir, editedIr, partBytes })).toThrowError(HwpxExportError);
  });

  it('누름틀 필드로 갈라진 run은 되쓰지 않고 거부한다 (doc-template-01 p[2])', () => {
    // 실문서에서 확인된 구조: hp:run 안이 [hp:t, hp:ctrl, hp:ctrl, hp:t]다.
    // IR에서는 단일 run으로 보이지만 새 텍스트를 어느 hp:t에 넣을지 결정할
    // 근거가 없다. 반씩 나눠 넣는 추측은 필드 값을 조용히 망가뜨린다.
    const file = corpus.files.find((item) => item.alias === 'doc-template-01')!;
    const { ir, partBytes } = prepare(file);
    const editedIr = clone(ir);
    let touched = false;
    eachParagraph(editedIr.sections[0].blocks, (paragraph) => {
      if (touched) return;
      if (paragraph.runs.length !== 1) return;
      if (paragraph.rawXmlAnchor !== 'Contents/section0.xml#p[2]') return;
      paragraph.runs[0].text = '필드가 섞인 문단';
      touched = true;
    });
    expect(touched).toBe(true);
    expect(() => buildXmlDelta({ baseIr: ir, editedIr, partBytes })).toThrowError(/HWPX-1103/);
  });

  it('섹션을 지우면 HWPX-1102로 거부한다', () => {
    const { ir, partBytes } = prepare(corpus.files[0]);
    const editedIr = clone(ir);
    editedIr.sections = [];
    expect(() => buildXmlDelta({ baseIr: ir, editedIr, partBytes })).toThrowError(HwpxExportError);
  });
});

describe('splice 적용', () => {
  it('겹치는 구간은 거부한다', () => {
    expect(() =>
      applySplices('0123456789', [
        { start: 2, end: 6, replacement: 'A', reason: 'a' },
        { start: 4, end: 8, replacement: 'B', reason: 'b' },
      ]),
    ).toThrowError(HwpxExportError);
  });

  it('맞닿은 구간(앞의 end == 뒤의 start)은 허용한다', () => {
    expect(
      applySplices('0123456789', [
        { start: 2, end: 4, replacement: 'A', reason: 'a' },
        { start: 4, end: 6, replacement: 'B', reason: 'b' },
      ]),
    ).toBe('01AB6789');
  });

  it('삽입(start == end)은 원문을 지우지 않는다', () => {
    expect(applySplices('0123', [{ start: 2, end: 2, replacement: 'XY', reason: 'insert' }])).toBe(
      '01XY23',
    );
  });

  it('순서를 뒤섞어 넣어도 결과가 같다', () => {
    const forward = applySplices('0123456789', [
      { start: 1, end: 2, replacement: 'A', reason: 'a' },
      { start: 5, end: 6, replacement: 'B', reason: 'b' },
    ]);
    const reversed = applySplices('0123456789', [
      { start: 5, end: 6, replacement: 'B', reason: 'b' },
      { start: 1, end: 2, replacement: 'A', reason: 'a' },
    ]);
    expect(forward).toBe(reversed);
    expect(forward).toBe('0A234B6789');
  });

  it('XML 텍스트 이스케이프는 &, <, >만 바꾼다', () => {
    expect(escapeXmlText('a<b>c&d"e\'f')).toBe('a&lt;b&gt;c&amp;d"e\'f');
  });
});
