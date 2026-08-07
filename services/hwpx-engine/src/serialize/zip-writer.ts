import { deflateRawSync } from 'node:zlib';
import { crc32, sha256Bytes, type ZipArchive, type ZipEntry } from '../package/zip-reader';
import { HwpxExportError } from './errors';

/**
 * ZIP 재작성기 (설계 07 §1.10-1/-3/-5).
 *
 * **설계 원칙: 되쓰지 않은 것은 원본 바이트 그대로 나른다.**
 * 리더가 `storedBytes`와 헤더 필드 원문을 보존해 둔 이유가 이것이다(CC-140 G-1).
 * 교체되지 않은 엔트리는 다시 압축하지 않는다 — 재압축은 zlib 버전·레벨에
 * 따라 바이트가 달라지므로, "우리가 건드리지 않은 부분은 원본과 같다"는
 * 무손실 주장을 도구 버전 문제로 바꿔 버린다.
 *
 * 따라서 교체가 하나도 없으면 출력은 **입력과 바이트 단위로 동일**하다.
 * 그것이 AC1(no-op round trip)의 정의이며 `writeZipArchive`의 계약이다.
 *
 * 압축은 node:zlib `deflateRawSync`만 쓴다(리더의 `inflateRawSync`와 대칭,
 * 신규 런타임 의존성 0 — ADR-29 D3의 무의존 원칙 유지).
 */

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const EOCD_BYTES = 22;

/** ZIP 명세상 deflate를 읽으려면 2.0, STORED는 1.0이면 된다. */
const VERSION_NEEDED_DEFLATE = 20;

/** general purpose flag bit 1~2 = deflate 압축 옵션. 우리 압축은 '표준'이므로 0. */
const FLAG_DEFLATE_OPTION_MASK = 0x0006;

/**
 * 한 엔트리를 어떻게 쓸지.
 *
 * `PRESERVE`는 원본 저장 바이트를 그대로 복사한다(재압축 없음).
 * `REPLACE`는 새 평문 바이트를 받아 다시 압축한다. 새 내용의 압축 방식은
 * **원본 엔트리의 방식을 따른다** — mimetype처럼 STORED여야 하는 엔트리를
 * 우리가 임의로 DEFLATE로 바꾸면 OPC 규약이 깨진다.
 */
export type ZipEntryPlan =
  | { readonly kind: 'PRESERVE'; readonly entry: ZipEntry }
  | { readonly kind: 'REPLACE'; readonly entry: ZipEntry; readonly bytes: Uint8Array };

export interface ZipWriteResult {
  readonly bytes: Uint8Array;
  readonly sha256: string;
  /** 원본 바이트를 그대로 복사한 엔트리 경로. */
  readonly preservedPaths: readonly string[];
  /** 다시 쓴 엔트리 경로. */
  readonly replacedPaths: readonly string[];
}

function dosFieldsAreWritable(entry: ZipEntry): void {
  // 리더가 이미 거부하는 조건들이지만, 쓰기 경로가 리더를 거치지 않은
  // 엔트리를 받을 수도 있으므로 여기서도 닫는다.
  if ((entry.generalPurposeFlags & 0x0001) !== 0) {
    throw new HwpxExportError('HWPX-1101', entry.path, '암호화된 엔트리는 재작성할 수 없습니다');
  }
  if ((entry.generalPurposeFlags & 0x0008) !== 0) {
    throw new HwpxExportError(
      'HWPX-1101',
      entry.path,
      'data descriptor(flag 0x08) 엔트리는 재작성할 수 없습니다',
    );
  }
}

interface PreparedEntry {
  readonly path: string;
  readonly pathBytes: Buffer;
  readonly method: number;
  readonly versionNeeded: number;
  readonly versionMadeBy: number;
  readonly flags: number;
  readonly dosTime: number;
  readonly dosDate: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly internalFileAttributes: number;
  readonly externalFileAttributes: number;
  readonly diskNumberStart: number;
  readonly localExtraField: Uint8Array;
  readonly centralExtraField: Uint8Array;
  readonly commentBytes: Buffer;
  readonly payload: Uint8Array;
  readonly replaced: boolean;
}

function prepare(plan: ZipEntryPlan): PreparedEntry {
  const { entry } = plan;
  dosFieldsAreWritable(entry);
  const pathBytes = Buffer.from(entry.path, 'utf8');
  const commentBytes = Buffer.from(entry.comment, 'utf8');

  if (plan.kind === 'PRESERVE') {
    return {
      path: entry.path,
      pathBytes,
      method: entry.method === 'STORED' ? 0 : 8,
      versionNeeded: entry.versionNeeded,
      versionMadeBy: entry.versionMadeBy,
      flags: entry.generalPurposeFlags,
      dosTime: entry.dosTime,
      dosDate: entry.dosDate,
      crc: entry.crc32,
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
      internalFileAttributes: entry.internalFileAttributes,
      externalFileAttributes: entry.externalFileAttributes,
      diskNumberStart: entry.diskNumberStart,
      localExtraField: entry.localExtraField,
      centralExtraField: entry.centralExtraField,
      commentBytes,
      payload: entry.storedBytes,
      replaced: false,
    };
  }

  const plain = plan.bytes;
  const stored = entry.method === 'STORED';
  const payload = stored ? plain : Uint8Array.prototype.slice.call(deflateRawSync(plain), 0);

  // 압축 옵션 비트는 우리 압축기의 설정을 반영해야 한다. 원본 값(한/글이 쓴
  // 값)을 그대로 두면 헤더가 내용을 거짓 진술한다.
  const flags = stored
    ? entry.generalPurposeFlags
    : entry.generalPurposeFlags & ~FLAG_DEFLATE_OPTION_MASK;

  return {
    path: entry.path,
    pathBytes,
    method: stored ? 0 : 8,
    versionNeeded: stored
      ? entry.versionNeeded
      : Math.max(entry.versionNeeded, VERSION_NEEDED_DEFLATE),
    versionMadeBy: entry.versionMadeBy,
    flags,
    // 수정 시각은 원본 값을 승계한다. 지금 시각을 넣으면 같은 입력이 실행할
    // 때마다 다른 바이트를 내어 증거(해시)가 재현되지 않는다.
    dosTime: entry.dosTime,
    dosDate: entry.dosDate,
    crc: crc32(plain),
    compressedSize: payload.length,
    uncompressedSize: plain.length,
    internalFileAttributes: entry.internalFileAttributes,
    externalFileAttributes: entry.externalFileAttributes,
    diskNumberStart: entry.diskNumberStart,
    localExtraField: entry.localExtraField,
    centralExtraField: entry.centralExtraField,
    commentBytes,
    payload,
    replaced: true,
  };
}

/**
 * 계획대로 ZIP을 쓴다. 엔트리 순서는 **주어진 배열 순서 그대로**다 —
 * 호출자가 원본 중앙디렉터리 순서를 유지할 책임을 진다(§1.10-3).
 */
export function writeZipArchive(
  plans: readonly ZipEntryPlan[],
  archiveComment: Uint8Array = new Uint8Array(0),
): ZipWriteResult {
  if (plans.length === 0) {
    throw new HwpxExportError('HWPX-1101', '(archive)', '엔트리가 없는 HWPX는 쓸 수 없습니다');
  }
  if (plans.length > 0xffff) {
    throw new HwpxExportError(
      'HWPX-1101',
      '(archive)',
      `엔트리 수가 ZIP(비-ZIP64) 한도를 넘습니다 (${plans.length})`,
    );
  }

  const prepared = plans.map(prepare);
  const seen = new Set<string>();
  for (const item of prepared) {
    if (seen.has(item.path)) {
      throw new HwpxExportError('HWPX-1101', item.path, '중복 엔트리 경로');
    }
    seen.add(item.path);
  }

  const chunks: Buffer[] = [];
  const localOffsets: number[] = [];
  let offset = 0;

  for (const item of prepared) {
    if (offset > 0xffffffff) {
      throw new HwpxExportError('HWPX-1101', item.path, 'ZIP64가 필요한 크기입니다 (미지원)');
    }
    localOffsets.push(offset);
    const header = Buffer.alloc(LOCAL_HEADER_BYTES);
    header.writeUInt32LE(SIG_LOCAL, 0);
    header.writeUInt16LE(item.versionNeeded, 4);
    header.writeUInt16LE(item.flags, 6);
    header.writeUInt16LE(item.method, 8);
    header.writeUInt16LE(item.dosTime, 10);
    header.writeUInt16LE(item.dosDate, 12);
    header.writeUInt32LE(item.crc, 14);
    header.writeUInt32LE(item.compressedSize, 18);
    header.writeUInt32LE(item.uncompressedSize, 22);
    header.writeUInt16LE(item.pathBytes.length, 26);
    header.writeUInt16LE(item.localExtraField.length, 28);

    chunks.push(
      header,
      item.pathBytes,
      Buffer.from(item.localExtraField),
      Buffer.from(item.payload),
    );
    offset +=
      LOCAL_HEADER_BYTES +
      item.pathBytes.length +
      item.localExtraField.length +
      item.payload.length;
  }

  const centralOffset = offset;
  let centralSize = 0;

  for (let i = 0; i < prepared.length; i += 1) {
    const item = prepared[i];
    const header = Buffer.alloc(CENTRAL_HEADER_BYTES);
    header.writeUInt32LE(SIG_CENTRAL, 0);
    header.writeUInt16LE(item.versionMadeBy, 4);
    header.writeUInt16LE(item.versionNeeded, 6);
    header.writeUInt16LE(item.flags, 8);
    header.writeUInt16LE(item.method, 10);
    header.writeUInt16LE(item.dosTime, 12);
    header.writeUInt16LE(item.dosDate, 14);
    header.writeUInt32LE(item.crc, 16);
    header.writeUInt32LE(item.compressedSize, 20);
    header.writeUInt32LE(item.uncompressedSize, 24);
    header.writeUInt16LE(item.pathBytes.length, 28);
    header.writeUInt16LE(item.centralExtraField.length, 30);
    header.writeUInt16LE(item.commentBytes.length, 32);
    header.writeUInt16LE(item.diskNumberStart, 34);
    header.writeUInt16LE(item.internalFileAttributes, 36);
    header.writeUInt32LE(item.externalFileAttributes, 38);
    header.writeUInt32LE(localOffsets[i], 42);

    chunks.push(header, item.pathBytes, Buffer.from(item.centralExtraField), item.commentBytes);
    centralSize +=
      CENTRAL_HEADER_BYTES +
      item.pathBytes.length +
      item.centralExtraField.length +
      item.commentBytes.length;
  }

  const eocd = Buffer.alloc(EOCD_BYTES);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(prepared.length, 8);
  eocd.writeUInt16LE(prepared.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(archiveComment.length, 20);
  chunks.push(eocd, Buffer.from(archiveComment));

  const bytes = Uint8Array.prototype.slice.call(Buffer.concat(chunks), 0);
  return {
    bytes,
    sha256: sha256Bytes(bytes),
    preservedPaths: prepared.filter((e) => !e.replaced).map((e) => e.path),
    replacedPaths: prepared.filter((e) => e.replaced).map((e) => e.path),
  };
}

/**
 * 원본 아카이브를 기준으로, 지정된 Part만 교체해 다시 쓴다.
 *
 * 원본에 없는 경로를 교체 대상으로 주면 거부한다 — 보존 저장은 **원본 구조를
 * 유지하는 것**이고, Part 신설은 manifest·관계 동기화가 필요한 다른 연산이다
 * (§1.10-2). 조용히 추가하면 content.hpf가 모르는 Part가 생긴다.
 */
export function rewriteArchive(
  archive: ZipArchive,
  replacements: ReadonlyMap<string, Uint8Array>,
): ZipWriteResult {
  for (const path of replacements.keys()) {
    if (!archive.byPath.has(path)) {
      throw new HwpxExportError(
        'HWPX-1102',
        path,
        '원본에 없는 Part는 보존 저장 경로에서 새로 만들 수 없습니다',
      );
    }
  }

  const plans: ZipEntryPlan[] = archive.entries.map((entry) => {
    const replacement = replacements.get(entry.path);
    return replacement === undefined
      ? { kind: 'PRESERVE', entry }
      : { kind: 'REPLACE', entry, bytes: replacement };
  });

  return writeZipArchive(plans, archive.archiveComment);
}
