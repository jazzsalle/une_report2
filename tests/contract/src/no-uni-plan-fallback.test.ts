import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoPath } from './contract-loader';

/**
 * CC-115 AC "no UNI plan fallback" — static guard for design 13 §1 / AT-T3Q-011
 * and CLAUDE.md "UNI calls in plan flow are prohibited". Runtime proof (zero
 * UNI calls in the plan E2E) is CC-170 scope; this test keeps UNI symbols out
 * of the plan-flow source tree in the meantime.
 */

/** Plan-flow and provider source roots that must stay UNI-free. Widened per
 * review N5/R3; CC-125 adds packages/provider-adapters/src/t3q here. Roots
 * that do not exist yet are skipped, but at least MIN_SCANNED files must be
 * seen overall so the guard cannot go vacuous. */
const GUARDED_ROOTS = [
  'services/api/src/plan',
  'services/worker/src',
  'apps/web/src',
  'apps/field-web/src',
  'packages/domain/src',
  'packages/provider-adapters/src/capability',
  'packages/provider-adapters/src/t3q',
];
const MIN_SCANNED = 10;

/**
 * CC-220이 연 예외 — **플랜 흐름이 아닌 UNI 경로**.
 *
 * 이 가드가 지키는 규칙은 "UNI calls in **plan flow** are prohibited"이지
 * "저장소에 UNI가 없다"가 아니다. CC-220의 지식문서 등록은 상황·SOP 자료
 * 흐름이며 계획서 생성과 무관하다 — 플랜 잡은 여전히 `T3qPlanProvider`만
 * 부르고 UNI 폴백이 없다.
 *
 * 루트를 통째로 빼지 않고 **경로를 정확히 적는다.** 그리고 존재 여부를
 * 단언한다 — 모듈이 사라지거나 이름이 바뀌면 예외가 남아 가드가 조용히
 * 넓어지는 것을 막는다.
 */
const NON_PLAN_UNI_PATHS = [
  'packages/domain/src/knowledge',
  'services/worker/src/knowledge',
  'packages/provider-adapters/src/capability/uni-knowledge-capabilities.ts',
];

function isExempt(fullPath: string): boolean {
  const normalized = fullPath.split(sep).join('/');
  return NON_PLAN_UNI_PATHS.some((p) => normalized.includes(`/${p}`) || normalized.endsWith(p));
}

/** UNI-specific tokens. Deliberately NOT a bare "uni" substring —
 * unique/unicode/unit would false-positive. */
const FORBIDDEN_TOKENS = [
  'uni-rag',
  'UniRag',
  'uniRag',
  'UniSop',
  'UniProvider',
  'uniClient',
  'UNI_',
  '221.147.100.161',
];

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (/\.(ts|tsx|mts|cts)$/.test(entry)) files.push(full);
  }
  return files;
}

describe('no UNI fallback in the plan flow (AT-T3Q-011 static guard)', () => {
  it('keeps UNI tokens out of guarded plan-flow sources', () => {
    let scanned = 0;
    for (const root of GUARDED_ROOTS) {
      const rootPath = repoPath(root);
      if (!existsSync(rootPath)) continue;
      for (const file of walk(rootPath)) {
        if (isExempt(file)) continue;
        scanned += 1;
        const source = readFileSync(file, 'utf8');
        for (const token of FORBIDDEN_TOKENS) {
          expect(source.includes(token), `${file} contains "${token}"`).toBe(false);
        }
      }
    }
    // Anti-vacuity: if refactors move the guarded roots, fail loudly instead
    // of silently scanning nothing.
    expect(scanned).toBeGreaterThanOrEqual(MIN_SCANNED);
  });

  it('예외 경로가 실제로 존재한다 (가드가 조용히 넓어지지 않는다)', () => {
    // 예외는 "지금 여기에 UNI 지식문서 코드가 있다"는 진술이다. 그 코드가
    // 사라지면 진술도 사라져야 한다 — 남겨 두면 나중에 그 경로에 들어온
    // 무엇이든 검사받지 않는다.
    for (const p of NON_PLAN_UNI_PATHS) {
      expect(existsSync(repoPath(p)), `${p} 예외가 낡았다`).toBe(true);
    }
  });

  it('플랜 흐름 자체에는 예외가 없다', () => {
    // 예외 경로가 플랜 소스로 새지 않는지 확인한다. 이 단언이 없으면
    // 'services/api/src/plan/...'을 예외에 적어 규칙을 통째로 우회할 수 있다.
    for (const p of NON_PLAN_UNI_PATHS) {
      expect(p.includes('/plan'), `${p}는 플랜 흐름 경로다`).toBe(false);
    }
  });

  it('keeps the generated UNI adapter types unimported outside their own package', () => {
    const roots = ['services/api/src', 'services/worker/src', 'packages/domain/src'];
    for (const root of roots) {
      for (const file of walk(repoPath(root))) {
        const source = readFileSync(file, 'utf8');
        expect(
          /from\s+['"][^'"]*uni-rag-adapter['"]/.test(source),
          `${file} imports uni-rag-adapter`,
        ).toBe(false);
      }
    }
  });
});
