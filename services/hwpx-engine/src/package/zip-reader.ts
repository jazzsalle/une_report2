import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { HwpxImportError } from './errors';
import { DEFAULT_HWPX_LIMITS, MAX_EOCD_SEARCH_BYTES, type HwpxLimits } from './limits';

/**
 * ZIP 중앙디렉터리 파서 (설계 07 §1.4-1/-2).
 *
 * **로컬 헤더를 신뢰하지 않는다.** 이름/크기/방식/CRC는 전부 중앙디렉터리
 * 값을 쓰고, 로컬 헤더에서는 데이터 시작 오프셋을 계산하기 위한
 * nameLength/extraLength만 읽는다. 로컬-중앙 이름 불일치는 그 자체로
 * 위조 신호이므로 거부한다(같은 아카이브를 도구마다 다르게 읽게 만드는
 * 고전적 우회).
 *
 * 압축해제는 node:zlib `inflateRawSync`만 사용한다(무의존).
 */

export type ZipCompressionMethod = 'STORED' | 'DEFLATE';

export interface ZipEntry {
  /** 정규화하지 않은 원본 경로. HWPX Part 경로로 그대로 쓴다. */
  readonly path: string;
  /** 중앙디렉터리 등장 순서(0-base). 원본 Part 순서 보존의 근거. */
  readonly order: number;
  readonly method: ZipCompressionMethod;
  readonly generalPurposeFlags: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly externalFileAttributes: number;
  /**
   * 아래 여섯 필드는 **바이트 동일 재작성**을 위한 것이다 (리뷰 G-1).
   *
   * 이것들이 없으면 CC-160이 증명할 수 있는 것은 "엔트리 내용 집합 동치"까지고
   * "원본 아카이브와 바이트가 같은 재작성"은 아니다. 읽는 비용은 오프셋 몇
   * 개라서, 지금 담아두는 편이 나중에 ZIP을 다시 파싱하는 것보다 싸다.
   * 해석하지 않고 원문 그대로 나른다.
   */
  readonly versionMadeBy: number;
  readonly versionNeeded: number;
  /** DOS 형식 수정 시각/날짜. 재작성 시 mtime을 원본대로 복원하기 위한 값. */
  readonly dosTime: number;
  readonly dosDate: number;
  readonly internalFileAttributes: number;
  /** 중앙디렉터리 extra field 원문 바이트. */
  readonly centralExtraField: Uint8Array;
  /** local header extra field 원문 바이트(중앙디렉터리와 다를 수 있다). */
  readonly localExtraField: Uint8Array;
  /** 엔트리 주석 원문. 한/글 산출물은 보통 비어 있다. */
  readonly comment: string;
  /** 아카이브에 저장된 그대로의 바이트(압축 상태). 재구성 동치 증명용. */
  readonly storedBytes: Uint8Array;
  /** 압축해제된 내용 바이트. */
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly storedSha256: string;
}

export interface ZipArchive {
  readonly entries: readonly ZipEntry[];
  readonly byPath: ReadonlyMap<string, ZipEntry>;
  readonly archiveSha256: string;
  readonly archiveBytes: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const SIG_ZIP64_EOCD_LOCATOR = 0x07064b50;

const UNIX_MODE_SYMLINK = 0xa000;
const UNIX_MODE_TYPE_MASK = 0xf000;

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const CRC32_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = -1;
  for (let i = 0; i < bytes.length; i += 1) c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function reject(locator: string, detail: string): never {
  throw new HwpxImportError('HWPX-1001', locator, detail);
}

function rejectLimit(locator: string, detail: string): never {
  throw new HwpxImportError('HWPX-1002', locator, detail);
}

/**
 * 경로 검증 — 절대경로/`..`/백슬래시/드라이브 문자/NUL/과도한 깊이를 거부한다.
 * ZIP 명세는 구분자를 '/'로 못박고 있으므로 '\\'가 보이면 Windows 경로를
 * 밀어넣으려는 시도이거나 비표준 생성기다. 둘 다 신뢰할 수 없다.
 */
function validatePath(path: string, limits: HwpxLimits): void {
  if (path.length === 0) reject('(empty)', 'ZIP 엔트리 경로가 비어 있습니다');
  if (path.length > limits.maxPathLength) {
    reject(path.slice(0, 64), `경로 길이 한도 초과 (${path.length} > ${limits.maxPathLength})`);
  }
  if (path.includes('\0')) reject(path.replace(/\0/g, '?'), '경로에 NUL 문자가 있습니다');
  if (path.includes('\\')) reject(path, '경로에 백슬래시가 있습니다 (path traversal 방어)');
  if (path.startsWith('/')) reject(path, '절대경로 엔트리는 허용하지 않습니다');
  if (/^[a-zA-Z]:/.test(path)) reject(path, '드라이브 문자로 시작하는 경로는 허용하지 않습니다');
  if (path.endsWith('/')) reject(path, '디렉터리 엔트리는 HWPX 패키지에 허용하지 않습니다');
  const segments = path.split('/');
  if (segments.length > limits.maxPathDepth) {
    reject(path, `경로 깊이 한도 초과 (${segments.length} > ${limits.maxPathDepth})`);
  }
  for (const segment of segments) {
    if (segment === '..') reject(path, "경로에 '..' 세그먼트가 있습니다 (path traversal)");
    if (segment === '') reject(path, '경로에 빈 세그먼트가 있습니다');
    if (segment === '.') reject(path, "경로에 '.' 세그먼트가 있습니다");
  }
}

function findEocd(buffer: Buffer): number {
  const lowerBound = Math.max(0, buffer.length - MAX_EOCD_SEARCH_BYTES);
  for (let i = buffer.length - 22; i >= lowerBound; i -= 1) {
    if (buffer.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return reject('(archive)', 'ZIP EOCD 서명을 찾을 수 없습니다 (ZIP 파일이 아님)');
}

export function readZipArchive(
  source: Uint8Array,
  limits: HwpxLimits = DEFAULT_HWPX_LIMITS,
): ZipArchive {
  const buffer = Buffer.isBuffer(source) ? source : Buffer.from(source);
  if (buffer.length > limits.maxArchiveBytes) {
    rejectLimit(
      '(archive)',
      `패키지 크기 한도 초과 (${buffer.length} > ${limits.maxArchiveBytes})`,
    );
  }
  if (buffer.length < 22) reject('(archive)', 'ZIP으로 보기에 너무 작습니다');
  if (buffer.readUInt32LE(0) !== SIG_LOCAL) {
    reject('(archive)', 'ZIP local file header 서명(PK\\x03\\x04)이 아닙니다');
  }

  const eocd = findEocd(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);

  if (entryCount === 0xffff || centralOffset === 0xffffffff || centralSize === 0xffffffff) {
    // ZIP64는 HWPX 실무 범위 밖이며, 부분 지원은 "읽는 도구마다 다른 결과"를
    // 만든다. 지원하지 않음을 명시적으로 거부한다(수용 한계로 기록).
    reject('(archive)', 'ZIP64 아카이브는 지원하지 않습니다');
  }
  if (eocd >= 20 && buffer.readUInt32LE(eocd - 20) === SIG_ZIP64_EOCD_LOCATOR) {
    reject('(archive)', 'ZIP64 EOCD locator가 있습니다 (미지원)');
  }
  if (entryCount > limits.maxEntries) {
    rejectLimit('(archive)', `엔트리 수 한도 초과 (${entryCount} > ${limits.maxEntries})`);
  }
  if (centralOffset + centralSize > buffer.length) {
    reject('(archive)', '중앙디렉터리 범위가 파일을 벗어납니다');
  }

  const entries: ZipEntry[] = [];
  const byPath = new Map<string, ZipEntry>();
  let cursor = centralOffset;
  let totalUncompressed = 0;

  for (let order = 0; order < entryCount; order += 1) {
    if (cursor + 46 > centralOffset + centralSize) {
      reject('(archive)', `중앙디렉터리 레코드 ${order}가 잘렸습니다`);
    }
    if (buffer.readUInt32LE(cursor) !== SIG_CENTRAL) {
      reject('(archive)', `중앙디렉터리 레코드 ${order} 서명이 올바르지 않습니다`);
    }
    const versionMadeBy = buffer.readUInt16LE(cursor + 4);
    const versionNeeded = buffer.readUInt16LE(cursor + 6);
    const generalPurposeFlags = buffer.readUInt16LE(cursor + 8);
    const rawMethod = buffer.readUInt16LE(cursor + 10);
    const dosTime = buffer.readUInt16LE(cursor + 12);
    const dosDate = buffer.readUInt16LE(cursor + 14);
    const storedCrc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const internalFileAttributes = buffer.readUInt16LE(cursor + 36);
    const externalFileAttributes = buffer.readUInt32LE(cursor + 38);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const path = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    const extraStart = cursor + 46 + nameLength;
    const centralExtraField = Uint8Array.prototype.slice.call(
      buffer,
      extraStart,
      extraStart + extraLength,
    );
    const comment = buffer.toString(
      'utf8',
      extraStart + extraLength,
      extraStart + extraLength + commentLength,
    );

    validatePath(path, limits);
    if (byPath.has(path)) {
      // 중복 경로는 "어느 쪽이 진짜인가"를 도구 선택에 맡기게 만든다.
      reject(path, '중복 엔트리 경로');
    }
    if ((generalPurposeFlags & 0x0001) !== 0) reject(path, '암호화된 엔트리는 지원하지 않습니다');
    if ((generalPurposeFlags & 0x0008) !== 0) {
      // data descriptor는 중앙디렉터리 크기와 로컬 크기가 어긋날 수 있는
      // 경로다. 중앙디렉터리 값만 신뢰한다는 원칙과 충돌하지 않도록
      // 여기서는 허용하되(한컴 산출물이 flag 0x4는 쓰지만 0x8은 안 씀),
      // 크기는 여전히 중앙디렉터리에서 읽는다.
      reject(path, 'data descriptor(flag 0x08) 엔트리는 지원하지 않습니다');
    }
    if (rawMethod !== 0 && rawMethod !== 8) {
      reject(path, `지원하지 않는 압축 방식 (method=${rawMethod})`);
    }
    if (((externalFileAttributes >>> 16) & UNIX_MODE_TYPE_MASK) === UNIX_MODE_SYMLINK) {
      reject(path, '심볼릭 링크 엔트리는 허용하지 않습니다');
    }
    if (uncompressedSize > limits.maxEntryUncompressedBytes) {
      rejectLimit(path, `압축해제 크기 한도 초과 (${uncompressedSize})`);
    }
    if (compressedSize > 0 && uncompressedSize / compressedSize > limits.maxCompressionRatio) {
      rejectLimit(
        path,
        `압축비 한도 초과 (${uncompressedSize}/${compressedSize} > ${limits.maxCompressionRatio})`,
      );
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.maxTotalUncompressedBytes) {
      rejectLimit(path, `총 압축해제 크기 한도 초과 (${totalUncompressed})`);
    }

    // 로컬 헤더: 데이터 시작 위치 계산에만 쓴다.
    if (localHeaderOffset + 30 > buffer.length) reject(path, 'local header 오프셋이 파일 밖입니다');
    if (buffer.readUInt32LE(localHeaderOffset) !== SIG_LOCAL) {
      reject(path, 'local file header 서명이 올바르지 않습니다');
    }
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const localName = buffer.toString(
      'utf8',
      localHeaderOffset + 30,
      localHeaderOffset + 30 + localNameLength,
    );
    if (localName !== path) {
      reject(path, `local header 경로가 중앙디렉터리와 다릅니다 (${localName})`);
    }
    const localExtraStart = localHeaderOffset + 30 + localNameLength;
    const localExtraField = Uint8Array.prototype.slice.call(
      buffer,
      localExtraStart,
      localExtraStart + localExtraLength,
    );
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) reject(path, '엔트리 데이터 범위가 파일을 벗어납니다');

    const storedBytes = Uint8Array.prototype.slice.call(buffer, dataStart, dataEnd);
    let bytes: Uint8Array;
    if (rawMethod === 0) {
      if (compressedSize !== uncompressedSize) {
        reject(path, 'STORED 엔트리의 압축/해제 크기가 다릅니다');
      }
      bytes = storedBytes;
    } else {
      let inflated: Buffer;
      try {
        inflated = inflateRawSync(storedBytes, { maxOutputLength: uncompressedSize + 1 });
      } catch (cause) {
        reject(path, `deflate 스트림을 해제할 수 없습니다 (${(cause as Error).message})`);
      }
      if (inflated.length !== uncompressedSize) {
        rejectLimit(
          path,
          `압축해제 크기가 중앙디렉터리와 다릅니다 (${inflated.length} != ${uncompressedSize})`,
        );
      }
      bytes = Uint8Array.prototype.slice.call(inflated, 0);
    }

    const actualCrc = crc32(bytes);
    if (actualCrc !== storedCrc) {
      reject(path, `CRC32 불일치 (0x${actualCrc.toString(16)} != 0x${storedCrc.toString(16)})`);
    }

    const entry: ZipEntry = {
      path,
      order,
      method: rawMethod === 0 ? 'STORED' : 'DEFLATE',
      generalPurposeFlags,
      crc32: storedCrc,
      compressedSize,
      uncompressedSize,
      externalFileAttributes,
      versionMadeBy,
      versionNeeded,
      dosTime,
      dosDate,
      internalFileAttributes,
      centralExtraField,
      localExtraField,
      comment,
      storedBytes,
      bytes,
      sha256: sha256Bytes(bytes),
      storedSha256: sha256Bytes(storedBytes),
    };
    entries.push(entry);
    byPath.set(path, entry);
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return {
    entries,
    byPath,
    archiveSha256: sha256Bytes(buffer),
    archiveBytes: buffer.length,
  };
}
