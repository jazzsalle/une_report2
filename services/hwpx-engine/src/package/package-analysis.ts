import type { HwpxFinding } from '@une/domain';
import { HwpxImportError, finding, sortFindings } from './errors';
import { DEFAULT_HWPX_LIMITS, type HwpxLimits } from './limits';
import {
  CONTAINER_PART,
  CONTENT_HPF_PART,
  HEADER_PART,
  MIMETYPE_PART,
  SECTION_PART_PATTERN,
  VERSION_PART,
  buildPreservationMap,
  collectUnmanifestedParts,
  readOpcPackage,
  type ManifestItem,
  type OpcPackage,
  type RootFile,
  type SourcePreservationMap,
} from './opc-package';
import { assertNoDoctype, parseXml, type XmlElement } from './xml';
import { readZipArchive, type ZipArchive, type ZipCompressionMethod } from './zip-reader';

/** AC2 산출물 (설계 07 §1.4). */
export interface PackageEntrySummary {
  readonly partPath: string;
  readonly order: number;
  readonly method: ZipCompressionMethod;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly sha256: string;
}

export interface RequiredPartStatus {
  readonly present: readonly string[];
  readonly missing: readonly string[];
}

export interface PackageAnalysisResult {
  readonly archiveSha256: string;
  readonly archiveBytes: number;
  readonly entries: readonly PackageEntrySummary[];
  readonly mimetype: string | null;
  readonly version: Readonly<Record<string, string>> | null;
  readonly rootfiles: readonly RootFile[];
  readonly hpfManifest: readonly ManifestItem[];
  readonly spine: readonly string[];
  readonly requiredParts: RequiredPartStatus;
  /** ZIP에는 있으나 hpf 매니페스트에 없는 Part(ADR-29 D8). 무손실의 핵심. */
  readonly unmanifestedParts: readonly string[];
  readonly sectionParts: readonly string[];
  readonly findings: readonly HwpxFinding[];
  /** 후속 단계(IR 빌더/분류기)가 재파싱하지 않도록 넘기는 내부 산출물. */
  readonly archive: ZipArchive;
  readonly opc: OpcPackage;
  readonly preservationMap: SourcePreservationMap;
  readonly parsedParts: ReadonlyMap<string, XmlElement>;
}

/** §1.4-1 교차검증이 요구하는 필수 Part 집합. section은 최소 1개. */
const REQUIRED_FIXED_PARTS = [
  MIMETYPE_PART,
  VERSION_PART,
  CONTAINER_PART,
  CONTENT_HPF_PART,
  HEADER_PART,
] as const;

/** XML로 파싱해 IR/분류가 소비하는 Part. 나머지는 바이트로만 보존한다. */
function isParsablePart(path: string): boolean {
  return path === HEADER_PART || SECTION_PART_PATTERN.test(path);
}

export function analyzePackage(
  source: Uint8Array,
  limits: HwpxLimits = DEFAULT_HWPX_LIMITS,
): PackageAnalysisResult {
  const archive = readZipArchive(source, limits);
  const opc = readOpcPackage(archive, limits);
  const findings: HwpxFinding[] = [...opc.findings];

  const sectionParts = archive.entries
    .map((entry) => entry.path)
    .filter((path) => SECTION_PART_PATTERN.test(path))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  const present: string[] = [];
  const missing: string[] = [];
  for (const part of REQUIRED_FIXED_PARTS) {
    if (archive.byPath.has(part)) present.push(part);
    else {
      missing.push(part);
      if (!findings.some((item) => item.locator === part && item.code === 'HWPX-1003')) {
        findings.push(finding('HWPX-1003', 'FATAL', part, `필수 Part가 없습니다: ${part}`));
      }
    }
  }
  if (sectionParts.length === 0) {
    missing.push('Contents/section*.xml');
    findings.push(
      finding('HWPX-1003', 'FATAL', 'Contents/section*.xml', 'section Part가 하나도 없습니다'),
    );
  } else {
    present.push(...sectionParts);
  }

  // §1.4-3: 모든 XML Part는 DTD/외부 엔터티 없이 읽는다. 파싱 대상이 아닌
  // XML Part(settings.xml, container.rdf 등)도 DOCTYPE 스캔은 통과해야 한다.
  const parsedParts = new Map<string, XmlElement>();
  for (const entry of archive.entries) {
    if (entry.path.endsWith('.xml') || entry.path === CONTENT_HPF_PART) {
      assertNoDoctype(entry.path, entry.bytes);
    }
    if (isParsablePart(entry.path)) {
      parsedParts.set(entry.path, parseXml(entry.path, entry.bytes, limits));
    }
  }

  const headerRoot = parsedParts.get(HEADER_PART);
  if (headerRoot && headerRoot.localName !== 'head') {
    findings.push(
      finding('HWPX-1003', 'FATAL', HEADER_PART, `루트가 hh:head가 아닙니다 (${headerRoot.qName})`),
    );
  }
  for (const sectionPart of sectionParts) {
    const root = parsedParts.get(sectionPart);
    if (root && root.localName !== 'sec') {
      findings.push(
        finding('HWPX-1003', 'FATAL', sectionPart, `루트가 hs:sec가 아닙니다 (${root.qName})`),
      );
    }
  }

  const unmanifested = collectUnmanifestedParts(archive, opc);
  if (unmanifested.length > 0) {
    findings.push(
      finding(
        'HWPX-1004',
        'INFO',
        CONTENT_HPF_PART,
        `hpf 매니페스트에 없는 Part ${unmanifested.length}개를 원문 보존합니다`,
      ),
    );
  }

  return {
    archiveSha256: archive.archiveSha256,
    archiveBytes: archive.archiveBytes,
    entries: archive.entries.map((entry) => ({
      partPath: entry.path,
      order: entry.order,
      method: entry.method,
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
      sha256: entry.sha256,
    })),
    mimetype: opc.mimetype,
    version: opc.versionAttributes,
    rootfiles: opc.rootfiles,
    hpfManifest: opc.manifest,
    spine: opc.spine,
    requiredParts: { present, missing },
    unmanifestedParts: unmanifested.map((entry) => entry.path),
    sectionParts,
    findings: sortFindings(findings),
    archive,
    opc,
    preservationMap: buildPreservationMap(archive),
    parsedParts,
  };
}

/** 던져진 반입 오류를 finding으로 환원해 호출자가 한 모양으로 다루게 한다. */
export function toFindings(error: unknown): HwpxFinding[] {
  if (error instanceof HwpxImportError) return [error.toFinding()];
  throw error;
}
