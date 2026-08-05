import { readFileSync } from 'node:fs';
import type { BlockIR, DocumentIR, ParagraphIR } from '@une/domain';
import { HwpxEngine, preservationSave } from '@une/hwpx-engine';

/**
 * 합성 대형 HWPX 생성기 (CC-170 성능 기준선).
 *
 * 보유 코퍼스는 23KB~500KB의 소형 문서 6종뿐이라 ADR G15-5의 "일반 50쪽"을
 * 잴 수 없다. 그래서 **실문서를 원본으로 두고 문단만 늘린다** — 처음부터
 * 합성하면 실문서의 병리(양식 필드가 텍스트를 쪼개는 run 구성, 표, 정적영역)가
 * 사라져 낙관적인 수치가 나온다. 원본을 그대로 두고 늘리면 그 병리가 남는다.
 *
 * 파일을 커밋하지 않는다. 대용량 바이너리를 저장소에 넣는 대신 테스트 시점에
 * **결정적으로** 만든다(같은 입력·같은 개수 → 같은 바이트).
 *
 * "50쪽"의 환산: 이 코퍼스 문서는 A4 한 쪽에 대략 40문단이 들어가는 서식이다.
 * 그래서 50쪽 ≈ 2,000문단으로 잡는다. 쪽 수는 렌더러가 정하는 값이고 우리는
 * 렌더하지 않으므로(설계 07 §1.1 비범위), 이 환산은 **가정**이며 증거 문서에
 * 그렇게 적는다.
 */

export const PARAGRAPHS_PER_PAGE = 40;

export interface SyntheticDocument {
  bytes: Uint8Array;
  paragraphCount: number;
  estimatedPages: number;
  sourceParagraphCount: number;
  elapsedMs: number;
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

/**
 * 되쓰기 가능한 기준 문단을 고른다.
 *
 * 삽입한 문단은 이 문단의 서식을 승계하므로, 텍스트가 있고 단순한 run 구성을
 * 가진 것이어야 한다. 정적영역은 피한다 — 결재란을 2,000번 복제하면 성능은
 * 재지만 문서는 말이 되지 않는다.
 */
function pickReference(ir: DocumentIR, staticAnchors: readonly string[]): ParagraphIR {
  let chosen: ParagraphIR | null = null;
  for (const block of ir.sections[0].blocks) {
    if (block.kind !== 'PARAGRAPH') continue;
    if (block.editState.locked) continue;
    if (block.runs.length === 0) continue;
    if (
      block.runs
        .map((run) => run.text)
        .join('')
        .trim().length === 0
    )
      continue;
    if (block.rawXmlAnchor && staticAnchors.includes(block.rawXmlAnchor)) continue;
    chosen = block;
  }
  if (!chosen) throw new Error('합성 기준으로 쓸 문단이 없다');
  return chosen;
}

/**
 * 목표 문단 수까지 늘린 HWPX 바이트를 만든다.
 *
 * 삽입을 한 번의 되쓰기로 처리한다 — 문단마다 저장하면 생성 자체가 O(n²)이
 * 되어 측정 준비가 측정보다 오래 걸린다.
 */
export function buildSyntheticDocument(
  templatePath: string,
  targetPages: number,
): SyntheticDocument {
  const started = Date.now();
  const engine = new HwpxEngine();
  const bytes = new Uint8Array(readFileSync(templatePath));
  const analysis = engine.analyzeDocument({ bytes, fileName: templatePath });
  const staticAnchors = analysis.profile.staticRegions.map((region) => region.locator);
  const reference = pickReference(analysis.ir, staticAnchors);

  const sourceParagraphCount = countParagraphs(analysis.ir);
  const target = targetPages * PARAGRAPHS_PER_PAGE;
  const toInsert = Math.max(0, target - sourceParagraphCount);

  const editedIr = JSON.parse(JSON.stringify(analysis.ir)) as DocumentIR;
  const index = editedIr.sections[0].blocks.findIndex(
    (block) => block.kind === 'PARAGRAPH' && block.paragraphId === reference.paragraphId,
  );

  const inserted: BlockIR[] = [];
  for (let i = 0; i < toInsert; i += 1) {
    const id = `P-synth-${String(i).padStart(5, '0')}`;
    inserted.push({
      kind: 'PARAGRAPH',
      paragraphId: id,
      runs: [
        {
          runId: `R-synth-${String(i).padStart(5, '0')}`,
          // 길이를 실제 본문에 가깝게 둔다 — 한 문단이 한 낱말이면 XML 크기가
          // 실제와 크게 달라지고, 그러면 파싱 시간이 낙관적으로 나온다.
          text: `${i + 1}. 합성 본문 문단입니다. 폭염 대비 조치사항과 담당 부서, 조치 시한을 기술합니다.`,
          charPrId: null,
          controls: [],
        },
      ],
      styleRef: JSON.parse(JSON.stringify(reference.styleRef)) as ParagraphIR['styleRef'],
      editState: { editedByUser: false, locked: false },
      origin: 'AUTHORED',
      // 첫 문단은 원본을, 이후는 바로 앞 문단을 가리킨다 — 실행기가 만드는
      // 체인과 같은 모양이다(CC-170이 되쓰기에서 이 체인을 풀도록 고쳤다).
      anchorHint: {
        relation: 'AFTER',
        ref: i === 0 ? reference.paragraphId : `P-synth-${String(i - 1).padStart(5, '0')}`,
      },
    } as BlockIR);
  }
  editedIr.sections[0].blocks.splice(index + 1, 0, ...inserted);

  const saved = preservationSave({
    sourceBytes: bytes,
    baseIr: analysis.ir,
    editedIr,
    mode: 'SAVE_AS',
    verdict: analysis.template.compatibility.verdict,
    hasFlattenExportOnlyObject: false,
  });

  const paragraphCount = sourceParagraphCount + toInsert;
  return {
    bytes: saved.outputBytes,
    paragraphCount,
    estimatedPages: Math.round(paragraphCount / PARAGRAPHS_PER_PAGE),
    sourceParagraphCount,
    elapsedMs: Date.now() - started,
  };
}

/** p50/p95. 표본이 적으면 p95는 최댓값에 가깝다 — 그 사실을 증거에 적는다. */
export function percentiles(samples: readonly number[]): { p50: number; p95: number; max: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (ratio: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
  return { p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] };
}
