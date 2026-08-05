import { resolve } from 'node:path';
import { TRACK_A_CHECKS, type BlockIR, type DocumentIR, type ParagraphIR } from '@une/domain';
import { describe, expect, it } from 'vitest';
import { HwpxEngine } from '../contract';
import { readZipArchive } from '../package/zip-reader';
import { loadCorpus, readCorpusFile, type CorpusFile } from '../testing/corpus';
import { HwpxExportError } from './errors';
import { isByteIdentical, preservationSave } from './preservation-save';
import { buildXmlDelta } from './xml-delta';

const REPO_ROOT = resolve(__dirname, '../../../..');
const corpus = loadCorpus(REPO_ROOT);
const engine = new HwpxEngine();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function eachParagraph(blocks: readonly BlockIR[], visit: (p: ParagraphIR) => void): void {
  for (const block of blocks) {
    if (block.kind === 'PARAGRAPH') visit(block);
    else if (block.kind === 'TABLE') {
      for (const row of block.rows) for (const cell of row.cells) eachParagraph(cell.blocks, visit);
    }
  }
}

function countParagraphs(ir: DocumentIR): number {
  let count = 0;
  for (const section of ir.sections) eachParagraph(section.blocks, () => (count += 1));
  return count;
}

/** 실제로 되쓸 수 있는 문단을 골라 텍스트를 바꾼 IR을 만든다. */
function editFirstEditableParagraph(
  ir: DocumentIR,
  partBytes: ReadonlyMap<string, Uint8Array>,
  newText: string,
): DocumentIR | null {
  for (let sectionIndex = 0; sectionIndex < ir.sections.length; sectionIndex += 1) {
    const ids: string[] = [];
    eachParagraph(ir.sections[sectionIndex].blocks, (paragraph) => {
      if (paragraph.runs.length === 1 && paragraph.runs[0].text.trim().length > 0) {
        ids.push(paragraph.paragraphId);
      }
    });
    for (const id of ids) {
      const editedIr = clone(ir);
      eachParagraph(editedIr.sections[sectionIndex].blocks, (paragraph) => {
        if (paragraph.paragraphId === id) paragraph.runs[0].text = newText;
      });
      try {
        buildXmlDelta({ baseIr: ir, editedIr, partBytes });
        return editedIr;
      } catch (error) {
        if (error instanceof HwpxExportError) continue;
        throw error;
      }
    }
  }
  return null;
}

function analyze(file: CorpusFile) {
  const bytes = readCorpusFile(file);
  const analysis = engine.analyzeDocument({ bytes, fileName: file.alias });
  const partBytes = new Map(
    readZipArchive(bytes).entries.map((entry) => [entry.path, entry.bytes]),
  );
  return { bytes, analysis, partBytes };
}

describe('보존 저장 — AC1 무편집 왕복', () => {
  for (const file of corpus.files) {
    it(`${file.alias}: 편집 없이 저장하면 원본과 바이트가 같고 Track A가 통과한다`, () => {
      const { bytes, analysis } = analyze(file);
      const result = preservationSave({
        sourceBytes: bytes,
        baseIr: analysis.ir,
        editedIr: clone(analysis.ir),
        mode: 'SAVE_AS',
        verdict: analysis.template.compatibility.verdict,
        hasFlattenExportOnlyObject: false,
      });

      expect(result.noOp).toBe(true);
      expect(result.spliceCount).toBe(0);
      expect(isByteIdentical(result.outputBytes, bytes)).toBe(true);
      expect(result.outputSha256).toBe(result.sourceSha256);
      expect(result.report.status).not.toBe('FAIL');
      expect(result.report.checks.filter((check) => check.outcome === 'FAIL')).toEqual([]);
    });
  }
});

describe('보존 저장 — AC3 미지원 객체 보존', () => {
  for (const file of corpus.files) {
    it(`${file.alias}: 주변 문단을 고쳐도 보존 객체가 원문 그대로다`, () => {
      const { bytes, analysis, partBytes } = analyze(file);
      const editedIr = editFirstEditableParagraph(analysis.ir, partBytes, 'UNE 보존 검증 문장');
      // 되쓸 수 있는 문단이 하나도 없으면 이 문서에 대해 AC3를 증명할 방법이
      // 없다 — 그 자체가 실패다. 예전에는 `toBeGreaterThanOrEqual(0)`으로
      // 빠져나갔는데 그것은 항상 참인 공허한 단언이었다(QA 리뷰 권고-5).
      expect(editedIr, `${file.alias}에 되쓰기 가능한 문단이 없다`).not.toBeNull();

      const result = preservationSave({
        sourceBytes: bytes,
        baseIr: analysis.ir,
        editedIr: editedIr as DocumentIR,
        mode: 'SAVE_AS',
        verdict: analysis.template.compatibility.verdict,
        hasFlattenExportOnlyObject: false,
      });

      expect(result.noOp).toBe(false);
      const preservedCheck = result.report.checks.find((check) => check.code === 'RTA-SEM-004');
      expect(preservedCheck?.outcome).toBe('PASS');

      const untouchedCheck = result.report.checks.find((check) => check.code === 'RTA-PKG-007');
      expect(untouchedCheck?.outcome).toBe('PASS');

      // 편집된 텍스트가 실제로 들어갔다.
      const reanalyzed = engine.analyzeDocument({ bytes: result.outputBytes });
      let seen = false;
      for (const section of reanalyzed.ir.sections) {
        eachParagraph(section.blocks, (paragraph) => {
          if (paragraph.runs.some((run) => run.text.includes('UNE 보존 검증 문장'))) seen = true;
        });
      }
      expect(seen).toBe(true);
    });
  }
});

describe('보존 저장 — AC2/AC4 검증 보고서', () => {
  it('보고서가 Track A 4계층의 모든 검사코드를 담는다', () => {
    const { bytes, analysis } = analyze(corpus.files[0]);
    const result = preservationSave({
      sourceBytes: bytes,
      baseIr: analysis.ir,
      editedIr: clone(analysis.ir),
      mode: 'SAVE_AS',
      verdict: analysis.template.compatibility.verdict,
      hasFlattenExportOnlyObject: false,
    });

    const codes = result.report.checks.map((check) => check.code).sort();
    expect(codes).toEqual([...TRACK_A_CHECKS].sort());
    expect(new Set(result.report.checks.map((check) => check.layer))).toEqual(
      new Set(['PACKAGE', 'REFERENCE', 'SEMANTIC', 'STYLE']),
    );
  });

  it('실행하지 않은 계층을 사유와 함께 신고한다 (침묵하지 않는다)', () => {
    const { bytes, analysis } = analyze(corpus.files[0]);
    const result = preservationSave({
      sourceBytes: bytes,
      baseIr: analysis.ir,
      editedIr: clone(analysis.ir),
      mode: 'SAVE_AS',
      verdict: analysis.template.compatibility.verdict,
      hasFlattenExportOnlyObject: false,
    });

    expect(result.report.notRunLayers.map((entry) => entry.layer)).toEqual([
      'VISUAL',
      'HANCOM',
      'EDIT',
    ]);
    for (const entry of result.report.notRunLayers) {
      expect(entry.reason.length).toBeGreaterThan(10);
    }
    // rhwp 미반입·Track B 릴리스 게이트가 사유로 명시된다(OB-12/OB-08).
    expect(result.report.notRunLayers[0].reason).toMatch(/rhwp/);
    expect(result.report.notRunLayers[1].reason).toMatch(/Track B/);
  });

  it('보고서가 어느 바이트를 검사했는지 해시로 못박는다', () => {
    const { bytes, analysis } = analyze(corpus.files[0]);
    const result = preservationSave({
      sourceBytes: bytes,
      baseIr: analysis.ir,
      editedIr: clone(analysis.ir),
      mode: 'SAVE_AS',
      verdict: analysis.template.compatibility.verdict,
      hasFlattenExportOnlyObject: false,
    });
    expect(result.report.outputSha256).toBe(result.outputSha256);
    expect(result.report.sourceSha256).toBe(analysis.package.archiveSha256);
  });
});

describe('보존 저장 — 문단 삽입·삭제 (ADR-31 D4 범위)', () => {
  /** 되쓰기 가능한 단일 run 문단을 찾는다(삽입 기준 노드가 된다). */
  function findAnchorParagraph(
    ir: DocumentIR,
    partBytes: ReadonlyMap<string, Uint8Array>,
  ): ParagraphIR | null {
    for (const candidate of ir.sections[0].blocks) {
      if (candidate.kind !== 'PARAGRAPH') continue;
      if (candidate.runs.length !== 1) continue;
      if (candidate.runs[0].text.trim().length === 0) continue;
      const probe = clone(ir);
      eachParagraph(probe.sections[0].blocks, (paragraph) => {
        if (paragraph.paragraphId === candidate.paragraphId) paragraph.runs[0].text = 'probe';
      });
      try {
        buildXmlDelta({ baseIr: ir, editedIr: probe, partBytes });
        return candidate;
      } catch (error) {
        if (error instanceof HwpxExportError) continue;
        throw error;
      }
    }
    return null;
  }

  function authoredParagraph(
    reference: ParagraphIR,
    relation: 'BEFORE' | 'AFTER' | 'FIRST_CHILD',
    text: string,
  ): BlockIR {
    return {
      kind: 'PARAGRAPH',
      paragraphId: 'P-authored-cc160',
      runs: [{ runId: 'R-authored-cc160', text, charPrId: null, controls: [] }],
      styleRef: clone(reference.styleRef),
      editState: { editedByUser: true, locked: false },
      origin: 'AUTHORED',
      anchorHint: { relation, ref: reference.paragraphId },
    } as BlockIR;
  }

  for (const file of corpus.files) {
    it(`${file.alias}: 문단을 뒤에 삽입하면 프로토타입 서식을 승계하고 Track A를 통과한다`, () => {
      const { bytes, analysis, partBytes } = analyze(file);
      const reference = findAnchorParagraph(analysis.ir, partBytes);
      expect(reference, `${file.alias}에 되쓰기 가능한 기준 문단이 있어야 한다`).not.toBeNull();

      const editedIr = clone(analysis.ir);
      const index = editedIr.sections[0].blocks.findIndex(
        (block) => block.kind === 'PARAGRAPH' && block.paragraphId === reference!.paragraphId,
      );
      editedIr.sections[0].blocks.splice(
        index + 1,
        0,
        authoredParagraph(reference!, 'AFTER', 'UNE 삽입 문단'),
      );

      const result = preservationSave({
        sourceBytes: bytes,
        baseIr: analysis.ir,
        editedIr,
        mode: 'SAVE_AS',
        verdict: analysis.template.compatibility.verdict,
        hasFlattenExportOnlyObject: false,
      });

      expect(result.noOp).toBe(false);
      expect(result.spliceCount).toBe(1);
      expect(result.report.status).not.toBe('FAIL');

      const reanalyzed = engine.analyzeDocument({ bytes: result.outputBytes });
      const texts: string[] = [];
      const styles: (number | null)[] = [];
      for (const section of reanalyzed.ir.sections) {
        eachParagraph(section.blocks, (paragraph) => {
          texts.push(paragraph.runs.map((run) => run.text).join(''));
          styles.push(paragraph.styleRef.paraPrId);
        });
      }
      const inserted = texts.indexOf('UNE 삽입 문단');
      expect(inserted).toBeGreaterThan(-1);
      // 프로토타입 복제이므로 기준 문단의 서식을 그대로 승계한다(§1.14).
      expect(styles[inserted]).toBe(reference!.styleRef.paraPrId);
      // 문단 수가 정확히 하나 늘었다.
      expect(texts).toHaveLength(countParagraphs(analysis.ir) + 1);
    });

    it(`${file.alias}: 문단을 삭제하면 그 문단만 사라지고 나머지는 그대로다`, () => {
      const { bytes, analysis, partBytes } = analyze(file);
      const target = findAnchorParagraph(analysis.ir, partBytes);
      expect(target).not.toBeNull();
      const removedText = target!.runs.map((run) => run.text).join('');

      const editedIr = clone(analysis.ir);
      editedIr.sections[0].blocks = editedIr.sections[0].blocks.filter(
        (block) => !(block.kind === 'PARAGRAPH' && block.paragraphId === target!.paragraphId),
      );

      const result = preservationSave({
        sourceBytes: bytes,
        baseIr: analysis.ir,
        editedIr,
        mode: 'SAVE_AS',
        verdict: analysis.template.compatibility.verdict,
        hasFlattenExportOnlyObject: false,
      });

      expect(result.spliceCount).toBe(1);
      expect(result.report.status).not.toBe('FAIL');

      const reanalyzed = engine.analyzeDocument({ bytes: result.outputBytes });
      const texts: string[] = [];
      for (const section of reanalyzed.ir.sections) {
        eachParagraph(section.blocks, (paragraph) => {
          texts.push(paragraph.runs.map((run) => run.text).join(''));
        });
      }
      expect(texts).toHaveLength(countParagraphs(analysis.ir) - 1);
      // 보존 객체는 삭제와 무관하게 그대로다(AC3).
      const preserved = result.report.checks.find((check) => check.code === 'RTA-SEM-004');
      expect(preserved?.outcome).toBe('PASS');
      expect(removedText.length).toBeGreaterThan(0);
    });
  }

  it('삽입 위치가 문단 안(FIRST_CHILD)이면 Track A가 잡아 산출물을 폐기한다 (D6)', () => {
    // 문단 안에 문단을 넣으면 중첩 hp:p가 되어 재분석 시 문단 수가 맞지 않는다.
    // 되쓰기 자체는 성공하지만 **검증이 막는다** — 이것이 D6의 안전망이며,
    // HWPX-1105가 실제로 던져지는지를 여기서 고정한다.
    const file = corpus.files[0];
    const { bytes, analysis, partBytes } = analyze(file);
    const reference = findAnchorParagraph(analysis.ir, partBytes);
    expect(reference).not.toBeNull();

    const editedIr = clone(analysis.ir);
    const index = editedIr.sections[0].blocks.findIndex(
      (block) => block.kind === 'PARAGRAPH' && block.paragraphId === reference!.paragraphId,
    );
    editedIr.sections[0].blocks.splice(
      index + 1,
      0,
      authoredParagraph(reference!, 'FIRST_CHILD', '잘못된 위치'),
    );

    let thrown: unknown = null;
    try {
      preservationSave({
        sourceBytes: bytes,
        baseIr: analysis.ir,
        editedIr,
        mode: 'SAVE_AS',
        verdict: analysis.template.compatibility.verdict,
        hasFlattenExportOnlyObject: false,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HwpxExportError);
    expect((thrown as HwpxExportError).code).toBe('HWPX-1105');
    // 어느 검사가 막았는지가 사유에 남는다.
    expect((thrown as HwpxExportError).detail).toMatch(/RTA-SEM-001/);
  });

  // ── CC-170: 본문 실체화가 실제로 밟은 경로 ────────────────────────────
  //
  // 아래 셋은 슬라이스 E2E(SSO→다운로드)가 처음 드러낸 결함들이다. CC-160은
  // 문단을 **하나** 넣는 경우만 시험했고, 실체화는 한 번에 여럿을 넣는다.

  it('한 ChangeSet이 문단을 여럿 넣으면 문서 순서대로 들어간다 (앵커 체인)', () => {
    const file = corpus.files[0];
    const { bytes, analysis, partBytes } = analyze(file);
    const reference = findAnchorParagraph(analysis.ir, partBytes);
    expect(reference).not.toBeNull();

    // 두 번째부터의 anchorHint는 **바로 앞에 넣은 AUTHORED 문단**을 가리킨다 —
    // 실행기가 넣은 순서대로 이웃을 잡기 때문이다. 되쓰기는 그 체인을 거슬러
    // 원본 문단까지 따라가야 한다.
    const first = authoredParagraph(reference!, 'AFTER', '실체화 1');
    const second = {
      ...authoredParagraph(reference!, 'AFTER', '실체화 2'),
      paragraphId: 'P-authored-cc170-2',
      anchorHint: { relation: 'AFTER', ref: 'P-authored-cc160' },
    } as BlockIR;
    const third = {
      ...authoredParagraph(reference!, 'AFTER', '실체화 3'),
      paragraphId: 'P-authored-cc170-3',
      anchorHint: { relation: 'AFTER', ref: 'P-authored-cc170-2' },
    } as BlockIR;

    const editedIr = clone(analysis.ir);
    const index = editedIr.sections[0].blocks.findIndex(
      (block) => block.kind === 'PARAGRAPH' && block.paragraphId === reference!.paragraphId,
    );
    editedIr.sections[0].blocks.splice(index + 1, 0, first, second, third);

    const result = preservationSave({
      sourceBytes: bytes,
      baseIr: analysis.ir,
      editedIr,
      mode: 'SAVE_AS',
      verdict: analysis.template.compatibility.verdict,
      hasFlattenExportOnlyObject: false,
    });
    expect(result.report.status).not.toBe('FAIL');

    const reanalyzed = engine.analyzeDocument({ bytes: result.outputBytes });
    const texts: string[] = [];
    for (const section of reanalyzed.ir.sections) {
      eachParagraph(section.blocks, (paragraph) => {
        texts.push(paragraph.runs.map((run) => run.text).join(''));
      });
    }
    const positions = ['실체화 1', '실체화 2', '실체화 3'].map((text) => texts.indexOf(text));
    expect(positions.every((position) => position >= 0)).toBe(true);
    // 순서가 뒤집히면 사용자가 쓴 목차 순서와 다른 문서가 나간다.
    expect(positions[0]).toBeLessThan(positions[1]);
    expect(positions[1]).toBeLessThan(positions[2]);
  });

  it('순환하는 anchorHint는 거부한다 (조용히 고치지 않는다)', () => {
    const file = corpus.files[0];
    const { analysis, partBytes } = analyze(file);
    const reference = findAnchorParagraph(analysis.ir, partBytes);
    const a = {
      ...authoredParagraph(reference!, 'AFTER', '순환 A'),
      anchorHint: { relation: 'AFTER', ref: 'P-authored-cycle-b' },
    } as BlockIR;
    const b = {
      ...authoredParagraph(reference!, 'AFTER', '순환 B'),
      paragraphId: 'P-authored-cycle-b',
      anchorHint: { relation: 'AFTER', ref: 'P-authored-cc160' },
    } as BlockIR;

    const editedIr = clone(analysis.ir);
    const index = editedIr.sections[0].blocks.findIndex(
      (block) => block.kind === 'PARAGRAPH' && block.paragraphId === reference!.paragraphId,
    );
    editedIr.sections[0].blocks.splice(index + 1, 0, a, b);

    expect(() => buildXmlDelta({ baseIr: analysis.ir, editedIr, partBytes })).toThrowError(/순환/);
  });

  it('의도한 서식이 앵커와 다르면 그 서식의 문단을 복제한다', () => {
    // 자리는 앵커가, **서식은 IR이** 정한다. 앵커를 그대로 복제하면 실행기가
    // 고른 프로토타입(§1.7)이 무시되고, 산출물을 다시 읽었을 때 IR과 달라
    // RTA-STY-001이 FAIL한다.
    const file = corpus.files[0];
    const { bytes, analysis, partBytes } = analyze(file);
    const reference = findAnchorParagraph(analysis.ir, partBytes);
    expect(reference).not.toBeNull();

    // 앵커와 **다른** 서식을 가진 원본 문단을 찾는다.
    let other: ParagraphIR | undefined;
    for (const section of analysis.ir.sections) {
      eachParagraph(section.blocks, (paragraph) => {
        if (other) return;
        if (paragraph.paragraphId === reference!.paragraphId) return;
        if (paragraph.styleRef.paraPrId === reference!.styleRef.paraPrId) return;
        if (paragraph.runs.length === 0) return;
        other = paragraph;
      });
    }
    expect(other, '서식이 다른 문단이 코퍼스에 있어야 한다').toBeDefined();
    const otherParagraph = other as unknown as ParagraphIR;

    const authored = {
      ...authoredParagraph(reference!, 'AFTER', '다른 서식 문단'),
      styleRef: clone(otherParagraph.styleRef),
    } as BlockIR;

    const editedIr = clone(analysis.ir);
    const index = editedIr.sections[0].blocks.findIndex(
      (block) => block.kind === 'PARAGRAPH' && block.paragraphId === reference!.paragraphId,
    );
    editedIr.sections[0].blocks.splice(index + 1, 0, authored);

    let outputStyle: unknown = null;
    let error: unknown = null;
    try {
      const result = preservationSave({
        sourceBytes: bytes,
        baseIr: analysis.ir,
        editedIr,
        mode: 'SAVE_AS',
        verdict: analysis.template.compatibility.verdict,
        hasFlattenExportOnlyObject: false,
      });
      const reanalyzed = engine.analyzeDocument({ bytes: result.outputBytes });
      for (const section of reanalyzed.ir.sections) {
        eachParagraph(section.blocks, (paragraph) => {
          if (paragraph.runs.map((run) => run.text).join('') === '다른 서식 문단') {
            outputStyle = paragraph.styleRef;
          }
        });
      }
    } catch (thrownError) {
      error = thrownError;
    }

    if (error) {
      // 그 서식의 복제 가능한 문단이 없으면 **거부**가 옳다 — 서식을 지어내지
      // 않는다. 그 경우에도 조용한 성공은 없어야 한다.
      expect(error).toBeInstanceOf(HwpxExportError);
      expect((error as HwpxExportError).detail).toMatch(/서식|복제/);
      return;
    }
    expect(outputStyle).toEqual(otherParagraph.styleRef);
  });
});

describe('보존 저장 — 저장 차단 집행 (ADR-29 D11)', () => {
  it('REJECT 판정 문서는 HWPX-1104로 저장을 거부한다', () => {
    const { bytes, analysis } = analyze(corpus.files[0]);
    try {
      preservationSave({
        sourceBytes: bytes,
        baseIr: analysis.ir,
        editedIr: clone(analysis.ir),
        mode: 'SAVE_AS',
        verdict: 'REJECT',
        hasFlattenExportOnlyObject: false,
      });
      throw new Error('저장이 차단되지 않았습니다');
    } catch (error) {
      expect(error).toBeInstanceOf(HwpxExportError);
      expect((error as HwpxExportError).code).toBe('HWPX-1104');
    }
  });

  it('FLATTEN_EXPORT_ONLY 객체가 있으면 EXPORT_COPY도 거부한다 (평탄화 변환기 미구현)', () => {
    const { bytes, analysis } = analyze(corpus.files[0]);
    for (const mode of ['SAVE_AS', 'SAVE_REVISION', 'EXPORT_COPY'] as const) {
      expect(() =>
        preservationSave({
          sourceBytes: bytes,
          baseIr: analysis.ir,
          editedIr: clone(analysis.ir),
          mode,
          verdict: analysis.template.compatibility.verdict,
          hasFlattenExportOnlyObject: true,
        }),
      ).toThrowError(/HWPX-1104/);
    }
  });

  it('AUTOSAVE_IR은 패키지를 만들지 않으므로 이 경로에서 거부한다', () => {
    const { bytes, analysis } = analyze(corpus.files[0]);
    expect(() =>
      preservationSave({
        sourceBytes: bytes,
        baseIr: analysis.ir,
        editedIr: clone(analysis.ir),
        mode: 'AUTOSAVE_IR',
        verdict: analysis.template.compatibility.verdict,
        hasFlattenExportOnlyObject: false,
      }),
    ).toThrowError(/HWPX-1102/);
  });
});
