import { describe, expect, it } from 'vitest';
import { HwpxImportError } from './errors';
import { DEFAULT_HWPX_LIMITS } from './limits';
import { buildZip, synthHwpx } from '../testing/synth-hwpx';
import { crc32, readZipArchive } from './zip-reader';

function expectImportError(action: () => unknown, code: string, fragment: RegExp): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(HwpxImportError);
    expect((error as HwpxImportError).code).toBe(code);
    expect((error as HwpxImportError).detail).toMatch(fragment);
    return;
  }
  throw new Error('오류가 발생하지 않았습니다');
}

describe('crc32', () => {
  it('표준 벡터 "123456789" == 0xCBF43926', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('빈 입력은 0', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('readZipArchive — 정상 경로', () => {
  it('중앙디렉터리 순서·압축방식·해시를 그대로 보존한다', () => {
    const archive = readZipArchive(synthHwpx('valid'));
    expect(archive.entries.map((entry) => entry.path)).toEqual([
      'mimetype',
      'version.xml',
      'Contents/header.xml',
      'Contents/section0.xml',
      'settings.xml',
      'Preview/PrvText.txt',
      'META-INF/container.rdf',
      'Contents/content.hpf',
      'META-INF/container.xml',
    ]);
    expect(archive.entries.map((entry) => entry.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    // mimetype/version.xml만 STORED로 조립했다.
    expect(archive.entries[0].method).toBe('STORED');
    expect(archive.entries[2].method).toBe('DEFLATE');
    expect(archive.archiveSha256).toHaveLength(64);
    for (const entry of archive.entries) {
      expect(entry.sha256).toHaveLength(64);
      expect(entry.bytes.length).toBe(entry.uncompressedSize);
      expect(crc32(entry.bytes)).toBe(entry.crc32);
    }
  });

  it('같은 입력을 두 번 읽으면 같은 해시가 나온다(결정성)', () => {
    const bytes = synthHwpx('valid');
    expect(readZipArchive(bytes).archiveSha256).toBe(readZipArchive(bytes).archiveSha256);
  });

  it('바이트 동일 재작성용 원문 메타데이터를 함께 읽는다 (리뷰 G-1)', () => {
    // 이 필드들이 없으면 재구성 동치가 증명하는 것은 "엔트리 내용 집합 동치"에
    // 그치고, CC-160의 "무편집 저장은 원본과 바이트가 같다"를 데이터로
    // 뒷받침할 수 없다. 해석하지 않고 원문 그대로 나른다.
    const archive = readZipArchive(synthHwpx('valid'));
    for (const entry of archive.entries) {
      expect(entry.versionMadeBy).toBe(20);
      expect(entry.versionNeeded).toBe(20);
      expect(entry.dosDate).toBe(0x0021); // 합성 라이터가 고정한 1980-01-01.
      expect(entry.dosTime).toBe(0);
      expect(entry.internalFileAttributes).toBe(0);
      expect(entry.centralExtraField).toHaveLength(0);
      expect(entry.localExtraField).toHaveLength(0);
      expect(entry.comment).toBe('');
    }
  });
});

describe('readZipArchive — 방어', () => {
  it('HWPX-1001: local file header 서명이 아니면 거부', () => {
    expectImportError(() => readZipArchive(synthHwpx('zip-signature-broken')), 'HWPX-1001', /서명/);
  });

  it('HWPX-1001: 경로 traversal 거부', () => {
    expectImportError(() => readZipArchive(synthHwpx('path-traversal')), 'HWPX-1001', /traversal/);
  });

  it('HWPX-1001: 중복 경로 거부', () => {
    expectImportError(() => readZipArchive(synthHwpx('duplicate-entry')), 'HWPX-1001', /중복/);
  });

  it('HWPX-1002: 압축비 한도 초과 거부(해제 전 중앙디렉터리 값으로 판정)', () => {
    expectImportError(() => readZipArchive(synthHwpx('zip-bomb')), 'HWPX-1002', /압축비 한도/);
  });

  it('HWPX-1001: 절대경로·백슬래시·드라이브 문자 거부', () => {
    for (const path of ['/etc/passwd', 'Contents\\header.xml', 'C:/evil.xml']) {
      expectImportError(
        () => readZipArchive(buildZip([{ path, data: 'x' }])),
        'HWPX-1001',
        /절대경로|백슬래시|드라이브/,
      );
    }
  });

  it('HWPX-1001: 디렉터리 엔트리 거부', () => {
    expectImportError(
      () => readZipArchive(buildZip([{ path: 'Contents/', data: '' }])),
      'HWPX-1001',
      /디렉터리/,
    );
  });

  it('HWPX-1002: 엔트리 수 한도', () => {
    const entries = Array.from({ length: 4 }, (_unused, index) => ({
      path: `p${index}.xml`,
      data: 'x',
    }));
    expectImportError(
      () => readZipArchive(buildZip(entries), { ...DEFAULT_HWPX_LIMITS, maxEntries: 3 }),
      'HWPX-1002',
      /엔트리 수 한도/,
    );
  });

  it('HWPX-1002: 총 압축해제 크기 한도', () => {
    expectImportError(
      () =>
        readZipArchive(synthHwpx('valid'), {
          ...DEFAULT_HWPX_LIMITS,
          maxTotalUncompressedBytes: 100,
        }),
      'HWPX-1002',
      /총 압축해제 크기/,
    );
  });

  it('HWPX-1001: 경로 깊이 한도', () => {
    expectImportError(
      () =>
        readZipArchive(buildZip([{ path: 'a/b/c/d.xml', data: 'x' }]), {
          ...DEFAULT_HWPX_LIMITS,
          maxPathDepth: 2,
        }),
      'HWPX-1001',
      /경로 깊이/,
    );
  });

  it('HWPX-1001: CRC32가 어긋나면 거부(중앙디렉터리 값을 신뢰하고 실제로 검증한다)', () => {
    const bytes = buildZip([{ path: 'mimetype', data: 'application/hwp+zip', store: true }]);
    const tampered = Uint8Array.prototype.slice.call(bytes, 0);
    // STORED 페이로드는 local header(30 + name 8) 직후에 있다.
    tampered[30 + 'mimetype'.length] = 0x58;
    expectImportError(() => readZipArchive(tampered), 'HWPX-1001', /CRC32/);
  });

  it('HWPX-1001: local header 경로가 중앙디렉터리와 다르면 거부', () => {
    const bytes = buildZip([{ path: 'settings.xml', data: '<a/>' }]);
    const tampered = Buffer.from(bytes);
    // local header의 파일명 첫 글자만 바꾼다. 중앙디렉터리는 그대로다.
    tampered[30] = 'z'.charCodeAt(0);
    expectImportError(() => readZipArchive(tampered), 'HWPX-1001', /local header 경로/);
  });

  it('HWPX-1001: EOCD가 없으면 ZIP이 아니다', () => {
    const bytes = new Uint8Array(64);
    bytes[0] = 0x50;
    bytes[1] = 0x4b;
    bytes[2] = 0x03;
    bytes[3] = 0x04;
    expectImportError(() => readZipArchive(bytes), 'HWPX-1001', /EOCD/);
  });
});
