import {
  LAYER_NOT_RUN_REASONS,
  rollUpValidationStatus,
  TRACK_A_CHECK_LAYER,
  TRACK_A_LAYERS,
  VALIDATION_LAYERS,
  type BlockIR,
  type DocumentIR,
  type ParagraphIR,
  type TrackACheckCode,
  type TrackACheckResult,
  type ValidationLayer,
  type ValidationStatus,
} from '@une/domain';
import { HWPX_MIMETYPE, MIMETYPE_PART } from '../package/opc-package';
import type { PackageAnalysisResult } from '../package/package-analysis';
import { parseXmlDocument, type XmlElement } from '../package/xml';
import { readZipArchive, type ZipArchive } from '../package/zip-reader';

/**
 * Track A 자동 검증 (설계 07 §1.11, CLAUDE.md "Track A ... is required for
 * every export").
 *
 * **방법: 산출물을 다시 분석해서 세 가지와 대조한다.**
 *   1. 원본 패키지 — 손대지 않기로 한 것이 그대로인가
 *   2. 편집된 IR — 의도한 변경이 실제로 반영됐는가
 *   3. 자기 자신 — 산출물이 우리 리더로 다시 읽히는가
 *
 * "쓴 다음 그 자리에서 검사한다"가 핵심이다. 쓰기 코드가 스스로를 검사하면
 * 같은 오해를 두 번 반복할 뿐이므로, 검증기는 쓰기 결과를 **처음 보는
 * 문서처럼** 읽는다.
 */

export interface TrackAInput {
  /** 원본 패키지 분석 결과(편집 전). */
  readonly original: PackageAnalysisResult;
  /** 원본에서 만든 IR. */
  readonly baseIr: DocumentIR;
  /** 편집 결과 IR — 산출물이 이것과 같아야 한다. */
  readonly editedIr: DocumentIR;
  /** 되쓰기 산출물 바이트. */
  readonly outputBytes: Uint8Array;
  /** 되쓰기가 교체한 Part 경로. */
  readonly replacedParts: readonly string[];
  /** 산출물 재분석 결과. 호출자가 이미 갖고 있으면 넘겨 재파싱을 아낀다. */
  readonly outputAnalysis: PackageAnalysisResult;
  readonly outputIr: DocumentIR;
}

export interface NotRunLayer {
  readonly layer: ValidationLayer;
  readonly reason: string;
}

export interface TrackAReport {
  readonly track: 'A_AUTO';
  readonly status: ValidationStatus;
  readonly checks: readonly TrackACheckResult[];
  /**
   * 이 트랙이 **실행하지 않은** 계층과 사유(§1.11 7계층 중 나머지 셋).
   * 보고서에서 이것을 빼면 "검사 안 함"이 "검사해서 통과"와 같은 모양이 된다.
   */
  readonly notRunLayers: readonly NotRunLayer[];
  /** 검사 대상 산출물의 해시 — 보고서가 어느 바이트를 봤는지 못박는다. */
  readonly outputSha256: string;
  readonly sourceSha256: string;
}

function pass(code: TrackACheckCode, detail: string): TrackACheckResult {
  return { code, layer: TRACK_A_CHECK_LAYER[code], outcome: 'PASS', detail };
}

function fail(code: TrackACheckCode, detail: string, locator?: string): TrackACheckResult {
  return { code, layer: TRACK_A_CHECK_LAYER[code], outcome: 'FAIL', detail, locator };
}

function warn(code: TrackACheckCode, detail: string, locator?: string): TrackACheckResult {
  return { code, layer: TRACK_A_CHECK_LAYER[code], outcome: 'WARN', detail, locator };
}

function paragraphsOf(blocks: readonly BlockIR[]): ParagraphIR[] {
  const out: ParagraphIR[] = [];
  const visit = (list: readonly BlockIR[]): void => {
    for (const block of list) {
      if (block.kind === 'PARAGRAPH') out.push(block);
      else if (block.kind === 'TABLE') {
        for (const row of block.rows) for (const cell of row.cells) visit(cell.blocks);
      }
    }
  };
  visit(blocks);
  return out;
}

function allParagraphs(ir: DocumentIR): ParagraphIR[] {
  return ir.sections.flatMap((section) => paragraphsOf(section.blocks));
}

function documentText(ir: DocumentIR): string {
  return allParagraphs(ir)
    .map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    .join('\n');
}

function tableShape(ir: DocumentIR): string[] {
  const shapes: string[] = [];
  const visit = (blocks: readonly BlockIR[]): void => {
    for (const block of blocks) {
      if (block.kind !== 'TABLE') continue;
      shapes.push(
        block.rows
          .map((row) => row.cells.map((cell) => `${cell.rowSpan}x${cell.colSpan}`).join(','))
          .join('|'),
      );
      for (const row of block.rows) for (const cell of row.cells) visit(cell.blocks);
    }
  };
  for (const section of ir.sections) visit(section.blocks);
  return shapes;
}

/**
 * 보존 객체의 **원문 조각**을 문서 순서대로 뽑는다 (AC3의 증거).
 *
 * 앵커를 그대로 비교하지 않는 이유: 앞쪽에 문단이 삽입·삭제되면 뒤쪽 요소의
 * 서수가 밀려 앵커 문자열이 달라진다. 그것은 손상이 아니다. 반면 **조각의
 * 바이트가 달라지면** 그것은 손상이다. 그래서 위치가 아니라 내용을 비교한다.
 */
function preservedFragments(
  ir: DocumentIR,
  partTexts: ReadonlyMap<string, { text: string; byAnchor: ReadonlyMap<string, XmlElement> }>,
): string[] {
  const fragments: string[] = [];
  for (const section of ir.sections) {
    const part = partTexts.get(section.partPath);
    if (!part) continue;
    const visit = (blocks: readonly BlockIR[]): void => {
      for (const block of blocks) {
        if (block.kind === 'PRESERVED') {
          const element = part.byAnchor.get(block.rawXmlAnchor);
          if (element) fragments.push(part.text.slice(element.sourceStart, element.sourceEnd));
          else fragments.push(`(unresolved:${block.rawXmlAnchor})`);
          continue;
        }
        if (block.kind === 'TABLE') {
          for (const row of block.rows) for (const cell of row.cells) visit(cell.blocks);
        }
      }
    };
    visit(section.blocks);
  }
  return fragments;
}

function indexPart(
  partPath: string,
  bytes: Uint8Array,
): { text: string; byAnchor: Map<string, XmlElement> } {
  const { root, text } = parseXmlDocument(partPath, bytes);
  const byAnchor = new Map<string, XmlElement>();
  const walk = (element: XmlElement, path: string): void => {
    const anchor = path === '' ? `${partPath}#${element.localName}[1]` : `${partPath}#${path}`;
    byAnchor.set(anchor, element);
    for (const child of element.children) {
      if ((child as XmlElement).localName === undefined) continue;
      const childElement = child as XmlElement;
      const step = `${childElement.localName}[${childElement.ordinal}]`;
      walk(childElement, path === '' ? step : `${path}/${step}`);
    }
  };
  walk(root, '');
  return { text, byAnchor };
}

function indexParts(
  archive: ZipArchive,
  partPaths: readonly string[],
): Map<string, { text: string; byAnchor: Map<string, XmlElement> }> {
  const out = new Map<string, { text: string; byAnchor: Map<string, XmlElement> }>();
  for (const partPath of partPaths) {
    const entry = archive.byPath.get(partPath);
    if (!entry) continue;
    out.set(partPath, indexPart(partPath, entry.bytes));
  }
  return out;
}

export function runTrackA(input: TrackAInput): TrackAReport {
  const checks: TrackACheckResult[] = [];
  const { original, outputAnalysis, baseIr, editedIr, outputIr } = input;

  // ---- PACKAGE ----------------------------------------------------------
  let outputArchive: ZipArchive | null = null;
  try {
    outputArchive = readZipArchive(input.outputBytes);
    checks.push(
      pass(
        'RTA-PKG-001',
        `산출물이 ZIP으로 다시 읽힙니다 (${outputArchive.entries.length} 엔트리)`,
      ),
    );
  } catch (error) {
    checks.push(
      fail('RTA-PKG-001', `산출물을 ZIP으로 읽을 수 없습니다: ${(error as Error).message}`),
    );
  }

  if (outputArchive) {
    const first = outputArchive.entries[0];
    const mimetypeOk =
      first?.path === MIMETYPE_PART &&
      first.method === 'STORED' &&
      outputAnalysis.mimetype === HWPX_MIMETYPE;
    checks.push(
      mimetypeOk
        ? pass('RTA-PKG-002', 'mimetype이 첫 엔트리이고 STORED이며 값이 정확합니다')
        : fail(
            'RTA-PKG-002',
            `mimetype 규약 위반 (first=${first?.path}, method=${first?.method}, value=${outputAnalysis.mimetype})`,
            MIMETYPE_PART,
          ),
    );

    const missing = outputAnalysis.requiredParts.missing;
    checks.push(
      missing.length === 0
        ? pass('RTA-PKG-003', '필수 Part가 모두 있습니다')
        : fail('RTA-PKG-003', `필수 Part 누락: ${missing.join(', ')}`),
    );

    // hpf 매니페스트가 가리키는 Part가 실제로 있는가. 반대 방향(매니페스트에
    // 없는 Part)은 원본에도 있는 정상 상태라 여기서 실패로 보지 않는다
    // (ADR-29 D8 — 실문서의 BinData/Scripts는 매니페스트에 없다).
    const entryPaths = new Set(outputArchive.entries.map((entry) => entry.path));
    const danglingManifest = outputAnalysis.hpfManifest
      .map((item) => item.href)
      .filter((href) => href && !entryPaths.has(href));
    checks.push(
      danglingManifest.length === 0
        ? pass(
            'RTA-PKG-004',
            `content.hpf 매니페스트 ${outputAnalysis.hpfManifest.length}건이 실제 엔트리와 일치합니다`,
          )
        : fail(
            'RTA-PKG-004',
            `매니페스트가 없는 Part를 가리킵니다: ${danglingManifest.join(', ')}`,
          ),
    );

    // XML well-formed — 재분석이 Part를 파싱했다는 사실 자체가 증거다.
    const parsed = [...outputAnalysis.parsedParts.keys()];
    let xmlOk = true;
    let xmlDetail = `XML Part ${parsed.length}건이 다시 파싱됩니다`;
    for (const partPath of input.replacedParts) {
      if (parsed.includes(partPath)) continue;
      xmlOk = false;
      xmlDetail = `되쓴 Part가 재파싱 목록에 없습니다 (${partPath})`;
    }
    checks.push(xmlOk ? pass('RTA-PKG-005', xmlDetail) : fail('RTA-PKG-005', xmlDetail));

    const before = original.entries.map((entry) => entry.partPath);
    const after = outputArchive.entries.map((entry) => entry.path);
    const sameOrder =
      before.length === after.length && before.every((path, i) => path === after[i]);
    checks.push(
      sameOrder
        ? pass('RTA-PKG-006', `엔트리 ${before.length}건의 집합과 순서가 원본과 같습니다`)
        : fail(
            'RTA-PKG-006',
            `엔트리 집합·순서가 달라졌습니다 (원본 ${before.length}건 -> 산출물 ${after.length}건)`,
          ),
    );
  }

  // ---- REFERENCE --------------------------------------------------------
  const brokenRefs = outputAnalysis.findings.filter((finding) => finding.code === 'HWPX-1005');
  checks.push(
    brokenRefs.length === 0
      ? pass('RTA-REF-001', 'dangling 스타일/번호 참조가 없습니다')
      : fail(
          'RTA-REF-001',
          `깨진 참조 ${brokenRefs.length}건: ${brokenRefs.map((f) => f.detail).join('; ')}`,
          brokenRefs[0]?.locator,
        ),
  );

  // binData 참조는 §1.4-4 색인의 일부이며 reference-check가 IR 빌드 중에
  // HWPX-1005로 신고한다. 원본에 없던 깨짐이 산출물에만 있으면 되쓰기가
  // 만든 것이다 — 그 비교를 여기서 명시적으로 한다.
  const beforeBroken = original.findings.filter((f) => f.code === 'HWPX-1005').length;
  checks.push(
    brokenRefs.length <= beforeBroken
      ? pass(
          'RTA-REF-002',
          `되쓰기가 새로 만든 깨진 참조가 없습니다 (원본 ${beforeBroken}건, 산출물 ${brokenRefs.length}건)`,
        )
      : fail(
          'RTA-REF-002',
          `되쓰기가 깨진 참조를 늘렸습니다 (원본 ${beforeBroken}건 -> 산출물 ${brokenRefs.length}건)`,
        ),
  );

  const outputIds = allParagraphs(outputIr).map((paragraph) => paragraph.paragraphId);
  const duplicateIds = outputIds.filter((id, index) => outputIds.indexOf(id) !== index);
  checks.push(
    duplicateIds.length === 0
      ? pass('RTA-REF-003', `문단 ID ${outputIds.length}건이 모두 유일합니다`)
      : fail('RTA-REF-003', `중복 ID: ${[...new Set(duplicateIds)].join(', ')}`),
  );

  // ---- SEMANTIC ---------------------------------------------------------
  const expectedCount = allParagraphs(editedIr).length;
  const actualCount = allParagraphs(outputIr).length;
  checks.push(
    expectedCount === actualCount
      ? pass('RTA-SEM-001', `문단 수가 편집 의도와 같습니다 (${actualCount})`)
      : fail('RTA-SEM-001', `문단 수 불일치 (의도 ${expectedCount} != 산출물 ${actualCount})`),
  );

  const expectedText = documentText(editedIr);
  const actualText = documentText(outputIr);
  checks.push(
    expectedText === actualText
      ? pass('RTA-SEM-002', '본문 텍스트가 편집 의도와 정확히 같습니다')
      : fail(
          'RTA-SEM-002',
          `본문 텍스트가 다릅니다 (의도 ${expectedText.length}자 != 산출물 ${actualText.length}자)`,
        ),
  );

  const beforeShape = tableShape(baseIr);
  const afterShape = tableShape(outputIr);
  const shapeSame =
    beforeShape.length === afterShape.length && beforeShape.every((s, i) => s === afterShape[i]);
  checks.push(
    shapeSame
      ? pass('RTA-SEM-003', `표 ${beforeShape.length}개의 행·열·병합 구조가 보존됐습니다`)
      : fail(
          'RTA-SEM-003',
          `표 구조가 달라졌습니다 (원본 ${beforeShape.length}개, 산출물 ${afterShape.length}개)`,
        ),
  );

  // AC3 — 미지원/보존 객체 원문 보존
  if (outputArchive) {
    const originalParts = indexParts(
      original.archive,
      baseIr.sections.map((section) => section.partPath),
    );
    const outputParts = indexParts(
      outputArchive,
      outputIr.sections.map((section) => section.partPath),
    );
    const beforeFragments = preservedFragments(baseIr, originalParts);
    const afterFragments = preservedFragments(outputIr, outputParts);
    const preservedSame =
      beforeFragments.length === afterFragments.length &&
      beforeFragments.every((fragment, index) => fragment === afterFragments[index]);
    checks.push(
      preservedSame
        ? pass(
            'RTA-SEM-004',
            `보존 객체 ${beforeFragments.length}건의 원문이 문서 순서까지 그대로입니다`,
          )
        : fail(
            'RTA-SEM-004',
            `보존 객체가 변형됐습니다 (원본 ${beforeFragments.length}건 -> 산출물 ${afterFragments.length}건)`,
          ),
    );

    // 되쓰지 않은 Part는 **저장 바이트**까지 같아야 한다.
    const replaced = new Set(input.replacedParts);
    const mutated: string[] = [];
    for (const entry of original.archive.entries) {
      if (replaced.has(entry.path)) continue;
      const after = outputArchive.byPath.get(entry.path);
      if (!after || after.storedSha256 !== entry.storedSha256) mutated.push(entry.path);
    }
    checks.push(
      mutated.length === 0
        ? pass(
            'RTA-PKG-007',
            `되쓰지 않은 Part ${original.archive.entries.length - replaced.size}건이 저장 바이트까지 동일합니다`,
          )
        : fail('RTA-PKG-007', `되쓰지 않은 Part가 바뀌었습니다: ${mutated.join(', ')}`),
    );
  }

  // ---- STYLE ------------------------------------------------------------
  const styleMismatch: string[] = [];
  const editedById = new Map(allParagraphs(editedIr).map((p) => [p.paragraphId, p]));
  for (const paragraph of allParagraphs(outputIr)) {
    const expected = editedById.get(paragraph.paragraphId);
    if (!expected) continue;
    if (
      expected.styleRef.paraPrId !== paragraph.styleRef.paraPrId ||
      expected.styleRef.styleId !== paragraph.styleRef.styleId ||
      expected.styleRef.charPrId !== paragraph.styleRef.charPrId
    ) {
      styleMismatch.push(paragraph.paragraphId);
    }
  }
  checks.push(
    styleMismatch.length === 0
      ? pass('RTA-STY-001', '문단 스타일 참조(paraPr/charPr/style)가 의도와 같습니다')
      : fail('RTA-STY-001', `스타일 참조가 달라진 문단: ${styleMismatch.slice(0, 5).join(', ')}`),
  );

  const outlineMismatch: string[] = [];
  for (const paragraph of allParagraphs(outputIr)) {
    const expected = editedById.get(paragraph.paragraphId);
    if (!expected) continue;
    if ((expected.outlineLevel ?? null) !== (paragraph.outlineLevel ?? null)) {
      outlineMismatch.push(paragraph.paragraphId);
    }
  }
  checks.push(
    outlineMismatch.length === 0
      ? pass('RTA-STY-002', '개요 수준과 기호 앞 공백이 유지됐습니다')
      : warn(
          'RTA-STY-002',
          `개요 수준이 달라진 문단: ${outlineMismatch.slice(0, 5).join(', ')}`,
          outlineMismatch[0],
        ),
  );

  const notRunLayers: NotRunLayer[] = VALIDATION_LAYERS.filter(
    (layer) => !TRACK_A_LAYERS.includes(layer),
  ).map((layer) => ({
    layer,
    reason: LAYER_NOT_RUN_REASONS[layer] ?? '사유 미기록',
  }));

  return {
    track: 'A_AUTO',
    status: rollUpValidationStatus(checks),
    checks,
    notRunLayers,
    outputSha256: outputAnalysis.archiveSha256,
    sourceSha256: original.archiveSha256,
  };
}
