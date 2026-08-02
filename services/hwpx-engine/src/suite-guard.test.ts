import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 테스트 스위트 자체의 가드 (리뷰 G-4).
 *
 * `vitest run`은 수집 단계에서 파일이 통째로 빠져도 "통과한 테스트 수"만
 * 크게 보여준다. 파일이 사라지거나 이름이 바뀌면 게이트는 초록인데 회귀는
 * 사라진 상태가 되므로, **디스크에 있는 테스트 파일 목록 자체**를 값으로
 * 고정한다. 파일을 추가할 때 이 목록도 같이 늘리는 것이 의도된 마찰이다.
 */

const SRC_ROOT = resolve(__dirname);

const EXPECTED_TEST_FILES = [
  'analysis/confidence.test.ts',
  'analysis/outline-pattern.test.ts',
  'analysis/prototype-registry.test.ts',
  'analysis/template-profile.test.ts',
  'compat/object-rules.test.ts',
  'contract.test.ts',
  'corpus-regression.test.ts',
  'edit/authored-id.test.ts',
  'edit/change-set-executor.test.ts',
  'edit/edit-invariants.test.ts',
  'edit/inverse-ops.test.ts',
  'edit/ir-lift.test.ts',
  'edit/prototype-resolve.test.ts',
  'edit/selection-resolver.test.ts',
  'ir/anchors.test.ts',
  'package/xml.test.ts',
  'package/zip-reader.test.ts',
  'suite-guard.test.ts',
  'synth-fixtures.test.ts',
  'testing/corpus.test.ts',
];

function collectTestFiles(directory: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      found.push(...collectTestFiles(path));
      continue;
    }
    if (name.endsWith('.test.ts')) found.push(relative(SRC_ROOT, path).replace(/\\/g, '/'));
  }
  return found;
}

describe('테스트 스위트 구성', () => {
  it('테스트 파일 목록이 고정 목록과 정확히 일치한다', () => {
    expect(collectTestFiles(SRC_ROOT).sort()).toEqual([...EXPECTED_TEST_FILES].sort());
  });
});
