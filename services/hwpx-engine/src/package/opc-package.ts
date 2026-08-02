import type { HwpxFinding } from '@une/domain';
import { HwpxImportError, finding } from './errors';
import { DEFAULT_HWPX_LIMITS, type HwpxLimits } from './limits';
import { childrenNamed, firstChild, parseXml, type XmlElement } from './xml';
import type { ZipArchive, ZipCompressionMethod, ZipEntry } from './zip-reader';

/**
 * OPC 컨테이너 교차검증 (설계 07 §1.4-1) + SourcePreservationMap (§1.4-5).
 *
 * 실 코퍼스 6종에서 확인된 사실(ADR-29 D8): `Contents/content.hpf`의
 * `opf:manifest`는 header/section0/settings(+Scripts)만 나열하고
 * **BinData·Preview·META-INF·mimetype·version.xml은 매니페스트에 없다.**
 * 따라서 `ZIP 엔트리 ⊃ hpf 매니페스트`이고, 비매니페스트 Part 전량 보존이
 * 무손실의 핵심이다. 그 목록을 `unmanifestedParts`로 1급 산출물로 낸다.
 */

export const HWPX_MIMETYPE = 'application/hwp+zip';

export const MIMETYPE_PART = 'mimetype';
export const VERSION_PART = 'version.xml';
export const CONTAINER_PART = 'META-INF/container.xml';
export const CONTENT_HPF_PART = 'Contents/content.hpf';
export const HEADER_PART = 'Contents/header.xml';
export const SECTION_PART_PATTERN = /^Contents\/section\d+\.xml$/;

/** IR이 직접 모델링하는 Part(= UnknownPart가 아닌 Part) 판별. */
export function isModeledPart(path: string): boolean {
  return (
    path === MIMETYPE_PART ||
    path === VERSION_PART ||
    path === CONTAINER_PART ||
    path === CONTENT_HPF_PART ||
    path === HEADER_PART ||
    SECTION_PART_PATTERN.test(path)
  );
}

export interface PreservedEntry {
  readonly partPath: string;
  /** 중앙디렉터리 순서. 재구성 시 Part 순서 동치의 근거. */
  readonly order: number;
  readonly method: ZipCompressionMethod;
  /** 압축해제된 내용 바이트(원본 그대로). */
  readonly bytes: Uint8Array;
  readonly sha256: string;
  /** 아카이브에 저장된 그대로의 바이트. */
  readonly storedBytes: Uint8Array;
  readonly storedSha256: string;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly generalPurposeFlags: number;
  readonly externalFileAttributes: number;
  /**
   * 바이트 동일 재작성용 원문 메타데이터 (리뷰 G-1).
   *
   * 이 필드들이 없으면 재구성 동치가 증명하는 것은 "엔트리 내용 집합 동치"에
   * 그친다. ZIP extra field·DOS mtime·versionMadeBy·주석이 빠진 채 다시 쓰면
   * 아카이브 바이트가 달라지고, "무편집 저장은 원본과 동일"이라는 CC-160의
   * 목표를 데이터로 뒷받침할 수 없다. 해석하지 않고 그대로 나른다.
   */
  readonly versionMadeBy: number;
  readonly versionNeeded: number;
  readonly dosTime: number;
  readonly dosDate: number;
  readonly internalFileAttributes: number;
  readonly centralExtraField: Uint8Array;
  readonly localExtraField: Uint8Array;
  readonly comment: string;
}

/** 경로 → 보존 레코드. I5(바이트 보존)와 무편집 재구성 동치의 데이터원. */
export type SourcePreservationMap = ReadonlyMap<string, PreservedEntry>;

export function buildPreservationMap(archive: ZipArchive): SourcePreservationMap {
  const map = new Map<string, PreservedEntry>();
  for (const entry of archive.entries) {
    map.set(entry.path, {
      partPath: entry.path,
      order: entry.order,
      method: entry.method,
      bytes: entry.bytes,
      sha256: entry.sha256,
      storedBytes: entry.storedBytes,
      storedSha256: entry.storedSha256,
      crc32: entry.crc32,
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
      generalPurposeFlags: entry.generalPurposeFlags,
      externalFileAttributes: entry.externalFileAttributes,
      versionMadeBy: entry.versionMadeBy,
      versionNeeded: entry.versionNeeded,
      dosTime: entry.dosTime,
      dosDate: entry.dosDate,
      internalFileAttributes: entry.internalFileAttributes,
      centralExtraField: entry.centralExtraField,
      localExtraField: entry.localExtraField,
      comment: entry.comment,
    });
  }
  return map;
}

export interface RootFile {
  readonly fullPath: string;
  readonly mediaType: string | null;
}

export interface ManifestItem {
  readonly id: string;
  readonly href: string;
  readonly mediaType: string | null;
  /** 매니페스트 원문 속성 전체(isEmbeded/hashkey 등 미해석 보존). */
  readonly attributes: Readonly<Record<string, string>>;
}

export interface OpcPackage {
  readonly mimetype: string | null;
  readonly versionAttributes: Readonly<Record<string, string>> | null;
  readonly rootfiles: readonly RootFile[];
  readonly manifest: readonly ManifestItem[];
  readonly spine: readonly string[];
  readonly findings: readonly HwpxFinding[];
}

function decodeText(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8');
}

/**
 * mimetype/version.xml/container.xml/content.hpf 교차검증.
 * 필수 Part 누락은 던지지 않고 FATAL finding으로 모은다 — 사용자가 "무엇이
 * 왜 REJECT인지" 전부를 한 번에 봐야 하기 때문이다(§1.4-6).
 */
export function readOpcPackage(
  archive: ZipArchive,
  limits: HwpxLimits = DEFAULT_HWPX_LIMITS,
): OpcPackage {
  const findings: HwpxFinding[] = [];

  const mimetypeEntry = archive.byPath.get(MIMETYPE_PART);
  let mimetype: string | null = null;
  if (!mimetypeEntry) {
    findings.push(finding('HWPX-1003', 'FATAL', MIMETYPE_PART, '필수 Part mimetype이 없습니다'));
  } else {
    mimetype = decodeText(mimetypeEntry.bytes);
    if (mimetype !== HWPX_MIMETYPE) {
      // §8.4 REJECT 등급 조건: "mimetype 불일치". 서명 자체가 틀렸으므로
      // 업로드 거부 계열(HWPX-1001)이다.
      throw new HwpxImportError(
        'HWPX-1001',
        MIMETYPE_PART,
        `mimetype이 ${HWPX_MIMETYPE}이 아닙니다 (${JSON.stringify(mimetype.slice(0, 64))})`,
      );
    }
    if (mimetypeEntry.method !== 'STORED') {
      findings.push(
        finding('HWPX-1004', 'INFO', MIMETYPE_PART, 'mimetype Part가 STORED가 아닙니다'),
      );
    }
    if (mimetypeEntry.order !== 0) {
      findings.push(
        finding('HWPX-1004', 'INFO', MIMETYPE_PART, 'mimetype Part가 첫 엔트리가 아닙니다'),
      );
    }
  }

  const versionEntry = archive.byPath.get(VERSION_PART);
  let versionAttributes: Record<string, string> | null = null;
  if (!versionEntry) {
    findings.push(finding('HWPX-1003', 'FATAL', VERSION_PART, '필수 Part version.xml이 없습니다'));
  } else {
    const versionRoot = parseXml(VERSION_PART, versionEntry.bytes, limits);
    if (versionRoot.localName !== 'HCFVersion') {
      findings.push(
        finding(
          'HWPX-1003',
          'FATAL',
          VERSION_PART,
          `루트가 HCFVersion이 아닙니다 (${versionRoot.qName})`,
        ),
      );
    }
    versionAttributes = { ...versionRoot.attributes };
  }

  const rootfiles: RootFile[] = [];
  const containerEntry = archive.byPath.get(CONTAINER_PART);
  if (!containerEntry) {
    findings.push(
      finding('HWPX-1003', 'FATAL', CONTAINER_PART, '필수 Part META-INF/container.xml이 없습니다'),
    );
  } else {
    const containerRoot = parseXml(CONTAINER_PART, containerEntry.bytes, limits);
    const rootfilesElement = firstChild(containerRoot, 'rootfiles');
    for (const node of rootfilesElement ? childrenNamed(rootfilesElement, 'rootfile') : []) {
      rootfiles.push({
        fullPath: node.attributes['full-path'] ?? '',
        mediaType: node.attributes['media-type'] ?? null,
      });
    }
    if (rootfiles.length === 0) {
      findings.push(
        finding('HWPX-1003', 'FATAL', CONTAINER_PART, 'rootfiles 항목이 하나도 없습니다'),
      );
    }
    for (const rootfile of rootfiles) {
      if (!archive.byPath.has(rootfile.fullPath)) {
        findings.push(
          finding(
            'HWPX-1005',
            'FATAL',
            CONTAINER_PART,
            `rootfile이 가리키는 Part가 없습니다: ${rootfile.fullPath}`,
          ),
        );
      }
    }
    if (!rootfiles.some((rootfile) => rootfile.fullPath === CONTENT_HPF_PART)) {
      findings.push(
        finding(
          'HWPX-1003',
          'FATAL',
          CONTAINER_PART,
          `rootfiles에 ${CONTENT_HPF_PART}가 선언되지 않았습니다`,
        ),
      );
    }
  }

  const manifest: ManifestItem[] = [];
  const spine: string[] = [];
  const hpfEntry = archive.byPath.get(CONTENT_HPF_PART);
  if (!hpfEntry) {
    findings.push(
      finding('HWPX-1003', 'FATAL', CONTENT_HPF_PART, '필수 Part content.hpf가 없습니다'),
    );
  } else {
    const hpfRoot: XmlElement = parseXml(CONTENT_HPF_PART, hpfEntry.bytes, limits);
    const manifestElement = firstChild(hpfRoot, 'manifest');
    for (const item of manifestElement ? childrenNamed(manifestElement, 'item') : []) {
      manifest.push({
        id: item.attributes.id ?? '',
        href: item.attributes.href ?? '',
        mediaType: item.attributes['media-type'] ?? null,
        attributes: { ...item.attributes },
      });
    }
    if (manifest.length === 0) {
      findings.push(
        finding('HWPX-1003', 'FATAL', CONTENT_HPF_PART, 'opf:manifest 항목이 하나도 없습니다'),
      );
    }
    const byId = new Map(manifest.map((item) => [item.id, item]));
    for (const item of manifest) {
      if (!archive.byPath.has(item.href)) {
        findings.push(
          finding(
            'HWPX-1005',
            'FATAL',
            CONTENT_HPF_PART,
            `manifest item '${item.id}'의 href Part가 ZIP에 없습니다: ${item.href}`,
          ),
        );
      }
    }
    const spineElement = firstChild(hpfRoot, 'spine');
    for (const ref of spineElement ? childrenNamed(spineElement, 'itemref') : []) {
      const idref = ref.attributes.idref ?? '';
      spine.push(idref);
      if (!byId.has(idref)) {
        findings.push(
          finding(
            'HWPX-1005',
            'FATAL',
            CONTENT_HPF_PART,
            `spine itemref '${idref}'가 manifest에 없습니다`,
          ),
        );
      }
    }
  }

  return {
    mimetype,
    versionAttributes,
    rootfiles,
    manifest,
    spine,
    findings,
  };
}

/** hpf 매니페스트에 없는 ZIP Part 목록(정렬). 무손실 보존의 대상 집합. */
export function collectUnmanifestedParts(
  archive: ZipArchive,
  opc: OpcPackage,
): readonly ZipEntry[] {
  const manifested = new Set(opc.manifest.map((item) => item.href));
  return archive.entries
    .filter((entry) => !manifested.has(entry.path))
    .sort((a, b) => a.path.localeCompare(b.path));
}
