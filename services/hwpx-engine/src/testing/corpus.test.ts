import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sha256Bytes } from '../package/zip-reader';
import { loadCorpus, parseCorpusManifest } from './corpus';

/**
 * 로더가 조용히 실패하면 "코퍼스가 비어 있는데 테스트는 통과"가 된다.
 * 그래서 파싱은 관대하지 않고, 못 읽는 줄을 만나면 던진다.
 *
 * ## 인라인 샘플만으로는 부족하다 (리뷰 F-2)
 *
 * 이 파일은 원래 인라인 문자열만 파싱하고 실물 `CORPUS.yaml`은 한 번도 읽지
 * 않았다. 그래서 매니페스트에 키가 추가됐을 때(measuredConfidence/capReason)
 * 파서와의 불일치가 **94케이스짜리 코퍼스 회귀**에서야 터졌다. 실물 로딩을
 * 여기 가벼운 단위 테스트로 두면 같은 불일치가 즉시, 싸게 드러난다.
 */

const SAMPLE = `# 주석
version: 1
dir: templete

files:
  - alias: a
    sha256: abc
    bytes: 10
    tags: [x, y]
    expectedVerdict: PENDING_MEASUREMENT
  - alias: b
    sha256: def
    bytes: 20
    tags: []
    expectedVerdict: LIMITED
`;

describe('parseCorpusManifest', () => {
  it('version/dir/files를 읽는다', () => {
    const parsed = parseCorpusManifest(SAMPLE);
    expect(parsed.version).toBe(1);
    expect(parsed.dir).toBe('templete');
    expect(parsed.entries).toEqual([
      {
        alias: 'a',
        sha256: 'abc',
        bytes: 10,
        tags: ['x', 'y'],
        expectedVerdict: 'PENDING_MEASUREMENT',
      },
      { alias: 'b', sha256: 'def', bytes: 20, tags: [], expectedVerdict: 'LIMITED' },
    ]);
  });

  it('주석과 빈 줄은 무시한다', () => {
    expect(parseCorpusManifest('# only a comment\nversion: 2\ndir: x\n').version).toBe(2);
  });

  it('알 수 없는 키는 던진다 — 새 필드가 조용히 사라지지 않게', () => {
    expect(() =>
      parseCorpusManifest('version: 1\ndir: x\nfiles:\n  - alias: a\n    surprise: 1\n'),
    ).toThrowError(/알 수 없는 키/);
  });

  it('해석 불가한 줄은 던진다', () => {
    expect(() => parseCorpusManifest('version: 1\ndir: x\nfiles:\n  garbage\n')).toThrowError(
      /해석할 수 없는 줄/,
    );
  });

  it('인라인 리스트가 아니면 던진다', () => {
    expect(() =>
      parseCorpusManifest('version: 1\ndir: x\nfiles:\n  - alias: a\n    tags: nope\n'),
    ).toThrowError(/인라인 리스트/);
  });
});

describe('loadCorpus — 실물 매니페스트 (리뷰 F-2)', () => {
  const REPO_ROOT = resolve(__dirname, '../../../..');
  const EXPECTED_ALIASES = [
    'brief-report-form',
    'doc-template-01',
    'doc-template-02',
    'report-form',
    'situation-report-template',
    'work-report-form',
  ];

  it('tests/hwpx/corpus/CORPUS.yaml이 파서와 어긋나지 않는다', () => {
    // 알 수 없는 키를 만나면 로더가 던지므로, 이 테스트가 통과한다는 것은
    // 매니페스트의 **모든 키**를 파서가 안다는 뜻이다.
    const corpus = loadCorpus(REPO_ROOT);
    expect(corpus.version).toBe(1);
    expect(corpus.dir.length).toBeGreaterThan(0);
    expect(corpus.files).toHaveLength(6);
    expect(corpus.files.map((file) => file.alias).sort()).toEqual(EXPECTED_ALIASES);
  });

  it('각 항목이 해시로 실제 파일에 해석되고 메타데이터가 채워져 있다', () => {
    for (const file of loadCorpus(REPO_ROOT).files) {
      expect(sha256Bytes(readFileSync(file.path))).toBe(file.sha256);
      expect(file.bytes).toBeGreaterThan(0);
      // PENDING_MEASUREMENT가 남아 있으면 실측 결과가 매니페스트에 반영되지
      // 않은 것이다 — 골든표와의 교차 고정이 무의미해진다.
      expect(file.expectedVerdict).not.toBe('PENDING_MEASUREMENT');
      expect(Number.isFinite(file.measuredConfidence)).toBe(true);
      expect(file.capReason.length).toBeGreaterThan(0);
    }
  });
});
