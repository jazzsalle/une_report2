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
  // CC-240: SOP 생성도 플랜 흐름이 아니다 — 설계 08 §1.11의 UNI SOP 스트림은
  // 상황·SOP 자료 흐름이고 계획서 생성과 무관하다. 플랜 잡은 여전히
  // `T3qPlanProvider`만 부른다.
  //
  // 워커 쪽 조립을 `sop/`에 가둔 이유가 여기 있다 — `main.ts`에 두면 플랜
  // 러너를 조립하는 파일을 예외로 만들어야 하고, 그러면 이 규칙이 가장 필요한
  // 자리에서 꺼진다(sop-wiring.ts 주석).
  'services/worker/src/sop',
  // 매퍼 어휘(`UNI_SOP_MAPPER_VERSION`, `UniRawCompn`)가 도메인에 산다 —
  // UNI 응답을 UNE 표준으로 옮기는 규칙 자체가 도메인 지식이기 때문이다.
  'packages/domain/src/sop',
];

function isExempt(fullPath: string): boolean {
  const normalized = fullPath.split(sep).join('/');
  return NON_PLAN_UNI_PATHS.some((p) => normalized.includes(`/${p}`) || normalized.endsWith(p));
}

/**
 * 계약에서 생성된 타입 파일 (CC-240).
 *
 * 이 파일들은 플랫폼 계약 **전체**를 옮긴 것이라 UNE-SOP-002의 설명에 들어 있는
 * provider 오류코드(`UNI_SOP_TIMEOUT` 등)를 그대로 담는다. 그 값들은 클라이언트가
 * `providerCode`로 실제 보게 되는 것이므로 계약에서 지울 수 없다.
 *
 * **그렇다고 통째로 예외로 두지는 않는다.** 주석을 걷어낸 뒤 검사한다 — 설명에
 * UNI 코드 이름이 적히는 것과, UNI 타입·클라이언트가 생성 코드에 들어오는 것은
 * 전혀 다른 일이다. 후자는 여전히 잡힌다.
 */
const GENERATED_CONTRACT_TYPES = [
  'apps/web/src/generated/une-platform-api.ts',
  'apps/field-web/src/generated/une-platform-api.ts',
  'services/api/src/generated/une-platform-api.ts',
];

function isGeneratedContractTypes(fullPath: string): boolean {
  const normalized = fullPath.split(sep).join('/');
  return GENERATED_CONTRACT_TYPES.some((p) => normalized.endsWith(p));
}

/** 블록 주석과 줄 주석을 걷어낸다. 문자열 안의 `//`는 고려하지 않는다 —
 * 생성 파일에는 그런 형태가 없고, 남겨서 잡히는 쪽이 안전하다. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
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
  // UNI 호스트 주소. **구·신 주소를 모두 남긴다** — 신 주소만 두면 아직 옛
  // 주소를 들고 있는 코드가 계획 흐름에 들어와도 이 가드가 통과시키고, 구
  // 주소만 두면 이전(2026-08-18, ADR-51) 이후 들어오는 것을 못 잡는다.
  '221.147.100.161',
  '10.20.10.101',
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
        const raw = readFileSync(file, 'utf8');
        const source = isGeneratedContractTypes(file) ? stripComments(raw) : raw;
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

  it('생성 타입 파일의 완화는 주석에만 적용된다', () => {
    // 완화가 파일 전체로 번지면 UNI 타입이 생성 코드에 들어와도 통과한다.
    // 주석을 걷어낸 뒤에도 토큰이 없다는 것을 여기서 못박는다.
    for (const p of GENERATED_CONTRACT_TYPES) {
      const full = repoPath(p);
      expect(existsSync(full), `${p} 완화가 낡았다`).toBe(true);
      const stripped = stripComments(readFileSync(full, 'utf8'));
      for (const token of FORBIDDEN_TOKENS) {
        expect(stripped.includes(token), `${p} code contains "${token}"`).toBe(false);
      }
      // 완화가 실제로 필요한 상태인지도 확인한다 — 필요 없어지면 지워야 한다.
      expect(isGeneratedContractTypes(full)).toBe(true);
    }
  });

  it('워커 조립 루트에는 UNI 토큰이 없다 (예외를 main.ts로 넓히지 않았다)', () => {
    // 예외 경로를 늘리는 것으로 이 가드를 통과시키는 길을 막는다. `main.ts`는
    // 플랜 잡 러너를 조립하는 파일이므로 여기에 UNI 심볼이 들어오면 플랜
    // 흐름에 UNI를 끼워 넣는 첫 걸음이 된다.
    const main = readFileSync(repoPath('services/worker/src/main.ts'), 'utf8');
    for (const token of FORBIDDEN_TOKENS) {
      expect(main.includes(token), `main.ts contains "${token}"`).toBe(false);
    }
    expect(isExempt(repoPath('services/worker/src/main.ts'))).toBe(false);
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
