import { createUniSopProvider, getUniKnowledgeCapability } from '@une/provider-adapters';
import type { WorkerConfig } from '../config/worker-config';
import type { WorkerDatabase } from '../db/worker-database.service';
import { SopJobRunner } from './sop-job.runner';

/**
 * SOP 생성 러너 조립 (CC-240).
 *
 * **왜 `main.ts`가 아니라 여기인가.** AT-T3Q-011 정적 가드가
 * `services/worker/src` 전체에서 UNI 토큰을 금지한다 — "플랜 흐름에 UNI 폴백이
 * 없다"를 소스 수준에서 지키는 장치다. `main.ts`는 플랜 잡 러너도 함께
 * 조립하는 파일이라 **거기에 예외를 두면 그 규칙이 가장 필요한 자리에서
 * 꺼진다.** 토큰을 피하려고 이름을 바꾸는 것도 답이 아니다(가드를 속이는 것이지
 * 규칙을 지키는 것이 아니다).
 *
 * 그래서 UNI 특정 조립을 SOP 도메인 폴더로 옮긴다. `knowledge/`가 CC-220에서
 * 같은 이유로 예외 경로가 됐고, 이 파일도 같은 자리에 선다 — 플랜 흐름이 아닌
 * UNI 경로다.
 */

export interface SopWiring {
  runner: SopJobRunner;
  /** 기동 로그 한 줄. 소스 관리된 capability 진술 + 인스턴스 런타임 사실. */
  capabilityLine: string;
}

export function createSopWiring(
  db: WorkerDatabase,
  config: WorkerConfig,
  env: NodeJS.ProcessEnv,
): SopWiring {
  const provider = createUniSopProvider(env);
  const capability = getUniKnowledgeCapability('sopGeneration');
  return {
    runner: new SopJobRunner(db, provider, config),
    // capability는 소스 관리된 진술이고 런타임 모드는 인스턴스 사실이다 —
    // 둘을 한 줄에 같이 적어야 mock 실행이 지원처럼 읽히지 않는다(AT-T3Q-012와
    // 같은 규칙).
    capabilityLine:
      `sopGeneration=${capability?.state ?? 'UNKNOWN'} ` +
      `(${capability?.openBinding ?? 'no binding'}) adapter=${provider.adapterId}` +
      (provider.isMock ? ' [MOCK RUNTIME — UNI 지원이 아니다]' : ' [실 HTTP — provider 미검증]'),
  };
}
