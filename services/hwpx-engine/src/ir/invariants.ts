import { documentIrHash, type BlockIR, type DocumentIR } from '@une/domain';
import { sha256Bytes } from '../package/zip-reader';
import type { PackageAnalysisResult } from '../package/package-analysis';
import { isModeledPart } from '../package/opc-package';
import type { XmlElement } from '../package/xml';
import { resolveAnchor, sourceAnchor } from './anchors';
import type { DocumentIrBuildResult } from './ir-builder';
import { checkBulletReference, findDanglingBinaryReferences } from './reference-check';

/**
 * IR 불변식 I1~I7 (ADR-29 D7 무손실 3중 증명 + 구조 정합).
 *
 * Package Writer(CC-160)가 없는 상태에서 "미지원 객체 무손실"을 데이터로
 * 선증명하는 장치다. I4(커버리지)·I5(바이트)와 무편집 재구성 동치가
 * RT-A의 **데이터 충분성**을 만든다.
 */

export type InvariantId = 'I1' | 'I2' | 'I3' | 'I4' | 'I5' | 'I6' | 'I7';

export interface InvariantViolation {
  readonly invariant: InvariantId;
  readonly locator: string;
  readonly detail: string;
}

export interface InvariantReport {
  readonly checked: readonly InvariantId[];
  readonly violations: readonly InvariantViolation[];
  /** 위반은 아니지만 회귀 감시가 필요한 관찰(병합 표의 행별 colSpan 합 등). */
  readonly observations: readonly InvariantViolation[];
  readonly ok: boolean;
  /** I1/I7 재현 확인에 쓴 두 번째 빌드의 해시. */
  readonly documentIrHash: string;
}

function violation(invariant: InvariantId, locator: string, detail: string): InvariantViolation {
  return { invariant, locator, detail };
}

function* walkBlocks(blocks: readonly BlockIR[]): Generator<BlockIR> {
  for (const block of blocks) {
    yield block;
    if (block.kind === 'TABLE') {
      for (const row of block.rows) {
        for (const cell of row.cells) yield* walkBlocks(cell.blocks);
      }
    }
  }
}

function collectAnchorsAndIds(ir: DocumentIR): {
  anchors: string[];
  ids: string[];
} {
  const anchors: string[] = [];
  const ids: string[] = [];
  for (const section of ir.sections) {
    ids.push(section.sectionId);
    anchors.push(section.pageSettings.rawXmlAnchor);
    for (const block of walkBlocks(section.blocks)) {
      if (block.kind === 'PARAGRAPH') {
        ids.push(block.paragraphId);
        anchors.push(sourceAnchor(block, block.paragraphId));
        for (const run of block.runs) {
          ids.push(run.runId);
          anchors.push(...run.controls);
        }
      } else if (block.kind === 'TABLE') {
        ids.push(block.tableId);
        anchors.push(sourceAnchor(block, block.tableId));
        for (const row of block.rows) {
          ids.push(row.rowId);
          for (const cell of row.cells) ids.push(cell.cellId);
        }
      } else {
        ids.push(block.preservedId);
        anchors.push(block.rawXmlAnchor);
      }
    }
  }
  return { anchors, ids };
}

export interface CheckInvariantsInput {
  readonly analysis: PackageAnalysisResult;
  readonly build: DocumentIrBuildResult;
  /** 동일 입력 재빌드 결과. I1/I7의 결정성 확인에 쓴다. */
  readonly rebuild: DocumentIrBuildResult;
}

export function checkInvariants(input: CheckInvariantsInput): InvariantReport {
  const { analysis, build, rebuild } = input;
  const ir = build.ir;
  const violations: InvariantViolation[] = [];
  const observations: InvariantViolation[] = [];

  // I1 — 안정 ID 유일·결정적.
  const { anchors, ids } = collectAnchorsAndIds(ir);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) violations.push(violation('I1', id, '안정 ID가 중복되었습니다'));
    seen.add(id);
  }
  const rebuiltIds = collectAnchorsAndIds(rebuild.ir).ids;
  if (rebuiltIds.length !== ids.length) {
    violations.push(
      violation('I1', '(document)', `재빌드 ID 개수 불일치 ${ids.length} != ${rebuiltIds.length}`),
    );
  } else {
    for (let i = 0; i < ids.length; i += 1) {
      if (ids[i] !== rebuiltIds[i]) {
        violations.push(violation('I1', ids[i], `재빌드에서 ID가 달라졌습니다 (${rebuiltIds[i]})`));
        break;
      }
    }
  }

  // I2 — 모든 rawXmlAnchor가 실재 Part+요소를 지목(역참조 100%).
  const parts: ReadonlyMap<string, XmlElement> = analysis.parsedParts;
  for (const anchor of anchors) {
    // 계약 스키마(`document-ir.schema.json`)의 rawXmlAnchor 패턴을 IR이 실제로
    // 만족하는지도 여기서 본다 — 스키마 검증은 tests/contract 소유지만, 엔진이
    // 애초에 위반 값을 만들지 않는 것이 먼저다.
    if (!/^[^#]+#.+$/.test(anchor)) {
      violations.push(violation('I2', anchor, '앵커 형식이 rawXmlAnchor 계약과 다릅니다'));
      continue;
    }
    if (!resolveAnchor(anchor, parts)) {
      violations.push(violation('I2', anchor, '앵커를 역참조할 수 없습니다'));
    }
  }

  // I3 — 모든 참조 id가 headerIndex에 존재(없으면 HWPX-1005).
  //
  // §1.4-4가 색인 대상으로 명시한 여섯 가지를 **전부** 본다: paraPr/charPr/
  // style/numbering/bullet/binData. 앞의 넷만 보던 구현은 `hp:pic`의
  // `binaryItemIDRef`가 깨져도 통과시켰다(리뷰 m-5). 심각도(FATAL/DEGRADING)와
  // 무관하게 "참조가 색인에 없다"는 사실 자체가 I3 위반이다 — finding은
  // 사용자에게 보여주는 층이고 불변식은 데이터 정합을 재는 층이다.
  for (const section of ir.sections) {
    for (const block of walkBlocks(section.blocks)) {
      if (block.kind !== 'PARAGRAPH') continue;
      const { paraPrId, charPrId, styleId, numberingId } = block.styleRef;
      const locator = sourceAnchor(block, block.paragraphId);
      if (paraPrId !== null && !build.headerIndex.paraPr.has(paraPrId)) {
        violations.push(violation('I3', locator, `paraPrId=${paraPrId} 미존재`));
      }
      if (charPrId !== null && !build.headerIndex.charPr.has(charPrId)) {
        violations.push(violation('I3', locator, `charPrId=${charPrId} 미존재`));
      }
      if (styleId !== null && !build.headerIndex.styleIds.has(styleId)) {
        violations.push(violation('I3', locator, `styleId=${styleId} 미존재`));
      }
      if (numberingId !== null && !build.headerIndex.numberingIds.has(numberingId)) {
        violations.push(violation('I3', locator, `numberingId=${numberingId} 미존재`));
      }
      const bulletDetail = checkBulletReference(build.headerIndex, paraPrId);
      if (bulletDetail !== null) {
        violations.push(violation('I3', locator, bulletDetail));
      }
    }
  }
  for (const section of ir.sections) {
    const root = analysis.parsedParts.get(section.partPath);
    if (!root) continue;
    for (const dangling of findDanglingBinaryReferences(root, build.headerIndex)) {
      violations.push(violation('I3', dangling.locator, dangling.detail));
    }
  }

  // I4 — 커버리지: 알려진 Part ∪ unknownParts == ZIP 엔트리 전체(차집합 0).
  const zipPaths = new Set(analysis.entries.map((entry) => entry.partPath));
  const knownPaths = new Set(
    analysis.entries.map((entry) => entry.partPath).filter((path) => isModeledPart(path)),
  );
  const unknownPaths = new Set(ir.unknownParts.map((part) => part.partPath));
  for (const path of zipPaths) {
    if (!knownPaths.has(path) && !unknownPaths.has(path)) {
      violations.push(violation('I4', path, 'ZIP 엔트리가 IR 커버리지에서 빠졌습니다'));
    }
  }
  for (const path of unknownPaths) {
    if (!zipPaths.has(path)) {
      violations.push(violation('I4', path, 'unknownPart가 ZIP에 없습니다'));
    }
    if (knownPaths.has(path)) {
      violations.push(violation('I4', path, '모델링 Part가 unknownPart로도 잡혔습니다'));
    }
  }

  // I5 — 바이트 보존: preservationMap 각 sha256 == 원본 엔트리 sha256.
  for (const entry of analysis.entries) {
    const preserved = analysis.preservationMap.get(entry.partPath);
    if (!preserved) {
      violations.push(violation('I5', entry.partPath, 'preservationMap에 엔트리가 없습니다'));
      continue;
    }
    const recomputed = sha256Bytes(preserved.bytes);
    if (recomputed !== entry.sha256 || preserved.sha256 !== entry.sha256) {
      violations.push(
        violation('I5', entry.partPath, `sha256 불일치 (${recomputed} != ${entry.sha256})`),
      );
    }
    if (preserved.uncompressedSize !== preserved.bytes.length) {
      violations.push(violation('I5', entry.partPath, '보존 바이트 길이가 선언과 다릅니다'));
    }
  }
  for (const unknown of ir.unknownParts) {
    const preserved = analysis.preservationMap.get(unknown.partPath);
    if (!preserved || preserved.sha256 !== unknown.hash) {
      violations.push(violation('I5', unknown.partPath, 'UnknownPart 해시가 보존맵과 다릅니다'));
    }
  }

  // I6 — 문단 순서·표 정합·셀당 최소 1문단.
  for (const section of ir.sections) {
    const root = analysis.parsedParts.get(section.partPath);
    if (root) {
      const paragraphAnchors = section.blocks
        .filter((block) => block.kind === 'PARAGRAPH')
        .map((block) => sourceAnchor(block, block.paragraphId));
      const sorted = [...paragraphAnchors].sort((a, b) => ordinalOf(a) - ordinalOf(b));
      if (paragraphAnchors.join('|') !== sorted.join('|')) {
        violations.push(violation('I6', section.partPath, '문단 블록 순서가 원문 순서와 다릅니다'));
      }
    }
    for (const block of walkBlocks(section.blocks)) {
      if (block.kind !== 'TABLE') continue;
      for (const row of block.rows) {
        for (const cell of row.cells) {
          if (cell.rowSpan < 1 || cell.colSpan < 1) {
            violations.push(violation('I6', cell.cellId, 'span 값이 1 미만입니다'));
          }
          const hasParagraph = [...walkBlocks(cell.blocks)].some(
            (inner) => inner.kind === 'PARAGRAPH',
          );
          if (!hasParagraph) {
            violations.push(violation('I6', cell.cellId, '셀에 문단이 없습니다'));
          }
        }
      }
      const widths = block.rows.map((row) =>
        row.cells.reduce((sum, cell) => sum + cell.colSpan, 0),
      );
      const distinct = new Set(widths);
      if (distinct.size > 1) {
        // 병합 표에서는 행마다 colSpan 합이 다를 수 있다. 위반이 아니라
        // 관찰이다 — 위반으로 올리면 정상 문서가 REJECT처럼 보인다.
        observations.push(
          violation('I6', block.tableId, `행별 colSpan 합이 다릅니다 (${[...distinct].join(',')})`),
        );
      }
    }
  }

  // I7 — documentIrHash 결정성.
  const hash = documentIrHash(ir);
  const rebuiltHash = documentIrHash(rebuild.ir);
  if (hash !== rebuiltHash) {
    violations.push(
      violation('I7', '(document)', `documentIrHash 불일치 ${hash} != ${rebuiltHash}`),
    );
  }

  return {
    checked: ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7'],
    violations,
    observations,
    ok: violations.length === 0,
    documentIrHash: hash,
  };
}

function ordinalOf(anchor: string): number {
  const match = /\[(\d+)\]$/.exec(anchor);
  return match ? Number(match[1]) : 0;
}

/**
 * 무편집 재구성 동치 (ADR-29 D7 세 번째 축).
 *
 * preservationMap만으로 원본 엔트리 집합을 **메모리 상** 재구성해 경로·순서·
 * 압축방식·바이트가 원본과 같음을 확인한다. 실제 ZIP을 쓰지 않는 이유는
 * Package Writer가 CC-160 소유이기 때문이다 — 여기서 증명하는 것은
 * "쓰기에 필요한 데이터가 전부 남아 있는가"이지 "쓰기가 맞는가"가 아니다.
 */
export interface ReconstructionEntry {
  readonly partPath: string;
  readonly order: number;
  readonly method: string;
  readonly storedSha256: string;
  readonly sha256: string;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly crc32: number;
}

export function reconstructEntries(analysis: PackageAnalysisResult): ReconstructionEntry[] {
  return [...analysis.preservationMap.values()]
    .sort((a, b) => a.order - b.order)
    .map((preserved) => ({
      partPath: preserved.partPath,
      order: preserved.order,
      method: preserved.method,
      storedSha256: sha256Bytes(preserved.storedBytes),
      sha256: sha256Bytes(preserved.bytes),
      compressedSize: preserved.compressedSize,
      uncompressedSize: preserved.uncompressedSize,
      crc32: preserved.crc32,
    }));
}
