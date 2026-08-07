import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readZipArchive, sha256Bytes } from '../package/zip-reader';
import { loadCorpus, readCorpusFile } from '../testing/corpus';
import { HwpxExportError } from './errors';
import { rewriteArchive, writeZipArchive } from './zip-writer';

const REPO_ROOT = resolve(__dirname, '../../../..');
const corpus = loadCorpus(REPO_ROOT);

/**
 * AC1(no-op round trip)의 가장 강한 형태를 여기서 고정한다.
 *
 * "다시 열리더라" 수준이 아니라 **출력 바이트가 입력 바이트와 같다**를 요구한다.
 * 약한 기준(엔트리 집합 동치)으로 두면 압축 방식·시각·extra field가 조용히
 * 바뀌어도 통과하고, 그 변화는 한/글에서만 드러난다.
 */
describe('ZIP 재작성기 — 무편집 바이트 동일성 (AC1)', () => {
  for (const file of corpus.files) {
    it(`${file.alias}: 교체 없이 재작성하면 원본과 바이트가 같다`, () => {
      const original = readCorpusFile(file);
      const archive = readZipArchive(original);
      const result = rewriteArchive(archive, new Map());

      expect(result.replacedPaths).toEqual([]);
      expect(result.preservedPaths).toHaveLength(archive.entries.length);
      expect(result.bytes.length).toBe(original.length);
      expect(result.sha256).toBe(sha256Bytes(original));
      expect(Buffer.compare(Buffer.from(result.bytes), Buffer.from(original))).toBe(0);
    });

    it(`${file.alias}: 재작성본이 다시 읽히고 엔트리 순서·해시가 보존된다`, () => {
      const original = readCorpusFile(file);
      const archive = readZipArchive(original);
      const rewritten = readZipArchive(rewriteArchive(archive, new Map()).bytes);

      expect(rewritten.entries.map((e) => e.path)).toEqual(archive.entries.map((e) => e.path));
      expect(rewritten.entries.map((e) => e.sha256)).toEqual(archive.entries.map((e) => e.sha256));
      expect(rewritten.entries.map((e) => e.method)).toEqual(archive.entries.map((e) => e.method));
      expect(rewritten.archiveSha256).toBe(archive.archiveSha256);
    });
  }

  it('코퍼스가 6종 그대로다 (테스트가 조용히 0건을 도는 것을 막는다)', () => {
    expect(corpus.files).toHaveLength(6);
    for (const file of corpus.files) {
      expect(sha256Bytes(readFileSync(file.path))).toBe(file.sha256);
    }
  });
});

describe('ZIP 재작성기 — 교체 경로', () => {
  const sample = corpus.files[0];

  it('교체한 Part만 바뀌고 나머지는 원본 저장 바이트 그대로다', () => {
    const archive = readZipArchive(readCorpusFile(sample));
    const target = archive.entries.find((e) => e.path.endsWith('.xml') && e.method === 'DEFLATE');
    expect(target).toBeDefined();

    const replacement = Buffer.from(`${Buffer.from(target!.bytes).toString('utf8')}<!-- x -->`);
    const result = rewriteArchive(archive, new Map([[target!.path, replacement]]));

    expect(result.replacedPaths).toEqual([target!.path]);
    const rewritten = readZipArchive(result.bytes);

    for (const entry of archive.entries) {
      const after = rewritten.byPath.get(entry.path);
      expect(after, entry.path).toBeDefined();
      if (entry.path === target!.path) {
        expect(after!.sha256).not.toBe(entry.sha256);
        expect(Buffer.from(after!.bytes).toString('utf8')).toContain('<!-- x -->');
      } else {
        // 건드리지 않은 엔트리는 **저장 바이트**까지 같아야 한다. 평문만 같고
        // 압축 결과가 다르면 "재압축했다"는 뜻이고, 그 순간 무손실 주장은
        // zlib 버전에 의존하게 된다.
        expect(after!.storedSha256, entry.path).toBe(entry.storedSha256);
      }
    }
  });

  it('mimetype처럼 STORED인 엔트리는 교체해도 STORED로 남는다', () => {
    const archive = readZipArchive(readCorpusFile(sample));
    const mimetype = archive.byPath.get('mimetype');
    expect(mimetype?.method).toBe('STORED');

    const result = rewriteArchive(
      archive,
      new Map([['mimetype', Buffer.from('application/hwp+zip')]]),
    );
    const rewritten = readZipArchive(result.bytes);
    expect(rewritten.byPath.get('mimetype')!.method).toBe('STORED');
    expect(rewritten.entries[0].path).toBe('mimetype');
  });

  it('원본에 없는 Part를 교체 대상으로 주면 HWPX-1102로 거부한다', () => {
    const archive = readZipArchive(readCorpusFile(sample));
    expect(() =>
      rewriteArchive(archive, new Map([['Contents/new.xml', Buffer.from('<a/>')]])),
    ).toThrowError(HwpxExportError);
    try {
      rewriteArchive(archive, new Map([['Contents/new.xml', Buffer.from('<a/>')]]));
    } catch (error) {
      expect((error as HwpxExportError).code).toBe('HWPX-1102');
    }
  });

  it('빈 계획은 거부한다 (엔트리 0개 ZIP은 HWPX가 아니다)', () => {
    expect(() => writeZipArchive([])).toThrowError(HwpxExportError);
  });

  it('같은 입력을 두 번 써도 바이트가 같다 (증거 재현성)', () => {
    const archive = readZipArchive(readCorpusFile(sample));
    const target = archive.entries.find((e) => e.path.endsWith('.xml') && e.method === 'DEFLATE')!;
    const replacement = Buffer.from(`${Buffer.from(target.bytes).toString('utf8')}<!-- y -->`);
    const first = rewriteArchive(archive, new Map([[target.path, replacement]]));
    const second = rewriteArchive(archive, new Map([[target.path, replacement]]));
    expect(first.sha256).toBe(second.sha256);
  });
});
