import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLOSE_BLOCKER_KINDS,
  CLOSE_DISPOSITIONS,
  EVALUATION_REPORT_FORMATS,
  EVALUATION_STATUSES,
  EVALUATION_TYPES,
  IMPROVEMENT_TARGET_TYPES,
} from '@une/domain';
import { loadYaml, repoPath } from './contract-loader';

/**
 * CC-310 계약 게이트 — 훈련 종료·평가·개선조치.
 *
 * 지키는 것 다섯.
 *   (1) **어휘가 도달 가능한 것만이다** — DB CHECK · 도메인 · 계약 셋이 같다.
 *   (2) **없는 것을 있다고 적지 않는다** — 만족도 수집 경로도, HWPX 보고서도 없다.
 *   (3) **종료 게이트가 미결을 목록으로 돌려준다** — 빈 412는 이유를 말하지 않는다.
 *   (4) **환류는 포인터다** — 대상 테이블을 쓰지 않는다.
 *   (5) 산출기는 하나다 — 평가가 자기 KPI 계산기를 만들지 않았다.
 */

const MIGRATION = readFileSync(
  join(repoPath('database', 'migrations'), '0045_exercise_close_and_evaluation.sql'),
  'utf8',
);
const SERVICE = readFileSync(
  repoPath('services', 'api', 'src', 'evaluation', 'evaluation.service.ts'),
  'utf8',
);
const REPOSITORY = readFileSync(
  repoPath('services', 'api', 'src', 'evaluation', 'evaluation.repository.ts'),
  'utf8',
);
const ERRORS = readFileSync(
  repoPath('services', 'api', 'src', 'evaluation', 'evaluation-errors.ts'),
  'utf8',
);

interface Schema {
  enum?: string[];
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean;
  items?: Schema;
  anyOf?: Schema[];
  description?: string;
  $ref?: string;
}

const doc = loadYaml('contracts', 'openapi', 'une-platform-api-v1.yaml') as {
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components: { schemas: Record<string, Schema> };
};
const schemas = doc.components.schemas;

const operations = new Map<string, Record<string, unknown>>();
for (const methods of Object.values(doc.paths)) {
  for (const operation of Object.values(methods)) {
    if (typeof operation !== 'object' || operation === null) continue;
    const id = (operation as Record<string, unknown>)['x-une-api-id'];
    if (typeof id === 'string') operations.set(id, operation as Record<string, unknown>);
  }
}

const EVAL_OPS = [
  'UNE-JNL-012',
  'UNE-JNL-012P',
  'UNE-JNL-013',
  'UNE-JNL-013R',
  'UNE-JNL-013C',
  'UNE-JNL-014',
  'UNE-JNL-015',
] as const;

describe('CC-310 계약: 네 연산이 실재한다', () => {
  it('설계가 적은 넷과 미리보기가 모두 있다', () => {
    for (const id of EVAL_OPS) {
      expect(operations.has(id), `${id} 없음`).toBe(true);
    }
  });

  it('권한이 설계와 같다', () => {
    expect(operations.get('UNE-JNL-012')?.['x-permission']).toBe('SITUATION_CLOSE');
    expect(operations.get('UNE-JNL-012P')?.['x-permission']).toBe('SITUATION_CLOSE');
    expect(operations.get('UNE-JNL-013')?.['x-permission']).toBe('EVALUATION_EDIT');
    expect(operations.get('UNE-JNL-014')?.['x-permission']).toBe('EVALUATION_EDIT');
    expect(operations.get('UNE-JNL-015')?.['x-permission']).toBe('EVALUATION_READ');
  });

  it('구현한 라우트가 모두 계약에 있다', () => {
    // CC-300에서 fact-refresh가 계약에 없던 것과 같은 결함을 막는다.
    const controller = readFileSync(
      repoPath('services', 'api', 'src', 'evaluation', 'evaluation.controller.ts'),
      'utf8',
    );
    const routes = [...controller.matchAll(/@(?:Get|Post)\('([^']*)'\)/g)].map((m) => m[1]);
    expect(routes.length).toBeGreaterThanOrEqual(7);
    const paths = Object.keys(doc.paths).join(' ');
    for (const route of routes) {
      const tail = route.replace(/^:[^/]+\/?/, '').replace(/:[a-zA-Z]+/g, '');
      if (tail.length === 0) continue;
      expect(paths.includes(tail), `${route}가 계약에 없다`).toBe(true);
    }
  });

  it('상태를 바꾸는 넷은 멱등 키를 요구한다', () => {
    for (const id of ['UNE-JNL-012', 'UNE-JNL-013', 'UNE-JNL-013C', 'UNE-JNL-014'] as const) {
      const params = (operations.get(id)?.parameters ?? []) as Array<{ $ref?: string }>;
      expect(
        params.some((p) => p.$ref?.includes('IdempotencyKey')),
        `${id} 멱등 키 없음`,
      ).toBe(true);
    }
  });
});

describe('CC-310 계약: 어휘가 세 곳에서 같다', () => {
  it('평가 상태 — DB CHECK · 도메인 · 계약', () => {
    expect(schemas.EvaluationStatus.enum).toEqual([...EVALUATION_STATUSES]);
    expect(MIGRATION).toContain("status IN ('OPEN', 'CONFIRMED')");
  });

  it('평가 유형은 EXERCISE 하나다 — 사용성 평가를 만드는 경로가 없다', () => {
    expect(EVALUATION_TYPES).toEqual(['EXERCISE']);
    expect(schemas.Evaluation.properties?.evaluationType.enum).toEqual(['EXERCISE']);
    expect(MIGRATION).toContain("evaluation_type IN ('EXERCISE')");
  });

  it('개선조치 상태는 OPEN 하나다 — 닫는 API가 없다', () => {
    expect(schemas.ImprovementAction.properties?.status.enum).toEqual(['OPEN']);
    expect(MIGRATION).toContain("status IN ('OPEN')");
  });

  it('환류 대상 어휘가 같다', () => {
    expect(schemas.ImprovementAction.properties?.targetType.anyOf?.[0].enum).toEqual([
      ...IMPROVEMENT_TARGET_TYPES,
    ]);
  });

  it('미결 종류와 처분 어휘가 같다', () => {
    expect(schemas.CloseBlockerKind.enum).toEqual([...CLOSE_BLOCKER_KINDS]);
    expect(schemas.CloseDisposition.enum).toEqual([...CLOSE_DISPOSITIONS]);
  });

  it('사유로 넘길 수 없는 미결이 계약에 드러난다', () => {
    // 큐에 남은 전파를 사유로 넘기면 닫은 뒤 그 지시가 조용히 죽는다.
    expect(schemas.CloseBlocker.required).toContain('waivable');
    expect(SERVICE).toContain('check.unwaivable');
  });
});

describe('CC-310 계약: 종료 게이트가 이유를 말한다', () => {
  it('412 응답이 미결 목록을 싣는다', () => {
    // 빈 412는 사용자가 왜 막혔는지 모르고 화면이 처분 UI를 그릴 근거도 없다.
    expect(ERRORS).toContain('meta: { blockers }');
    expect(schemas.CloseBlocker.required).toEqual(['kind', 'refId', 'label', 'detail', 'waivable']);
  });

  it('처분에 사유가 필수다', () => {
    const disposition = schemas.SituationCloseRequest.properties?.dispositions.items;
    expect(disposition?.required).toEqual(['refId', 'disposition', 'reason']);
    expect(SERVICE).toContain('checkDispositions');
    expect(SERVICE).toContain('canClose');
  });

  it('완료·취소를 이 경로에서 흉내 내지 않는다', () => {
    // 상태가 자기 상태기계 밖에서 바뀌면 그 전이는 사실원장에 제대로 남지 않는다.
    expect(CLOSE_DISPOSITIONS).toEqual(['WAIVED']);
    expect(REPOSITORY).not.toMatch(/UPDATE task SET status/);
    expect(REPOSITORY).not.toMatch(/UPDATE sop_run SET status/);
  });

  it('종료 사건과 기준선 해시를 남긴다', () => {
    expect(SERVICE).toContain("eventType: 'SITUATION_CLOSED'");
    expect(SERVICE).toContain('closureBaselineHash');
    expect(schemas.SituationClosed.required).toContain('baselineHash');
    expect(schemas.SituationClosed.required).toContain('closureEventId');
  });

  it('종료 뒤에는 새 사실을 막고 정정만 연다', () => {
    // 전부 막으면 US-SIT-036 E-02(평가 중 원 이벤트 정정)가 죽고,
    // 아무것도 안 막으면 최종 기준선이 거짓이 된다.
    expect(MIGRATION).toContain('une_guard_closed_situation_events');
    expect(MIGRATION).toContain("'EXECUTION_EVENT_CORRECTED', 'SITUATION_CLOSED'");
  });
});

describe('CC-310 계약: 없는 것을 있다고 적지 않는다', () => {
  it('만족도는 부재를 1급 값으로 적는다', () => {
    expect(schemas.SatisfactionSection.properties?.status.enum).toEqual(['NOT_COLLECTED']);
    expect(schemas.SatisfactionSection.required).toContain('reason');
    expect(schemas.EvaluationReport.required).toContain('satisfaction');
  });

  it('survey_response를 x-db-tables에서 뺐다 — 그 테이블은 존재하지 않는다', () => {
    const tables = (operations.get('UNE-JNL-015')?.['x-db-tables'] ?? []) as string[];
    expect(tables).not.toContain('survey_response');
    // 마이그레이션 어디에도 만들지 않았다.
    expect(MIGRATION).not.toContain('survey_response');
  });

  it('보고서 형식은 JSON뿐이다', () => {
    expect(EVALUATION_REPORT_FORMATS).toEqual(['JSON']);
    const params = (operations.get('UNE-JNL-015')?.parameters ?? []) as Array<{
      name?: string;
      schema?: { enum?: string[] };
    }>;
    const format = params.find((p) => p.name === 'format');
    expect(format?.schema?.enum).toEqual(['JSON']);
  });

  it('분모 0을 0%로 적지 않는다', () => {
    expect(schemas.Evaluation.properties?.overallScore.description).toMatch(/null/);
  });
});

describe('CC-310 계약: 환류는 포인터다', () => {
  it('대상 테이블에 쓰지 않는다', () => {
    // "자동변경 금지" — 개선조치는 SOP·계획서를 가리키기만 한다.
    expect(REPOSITORY).not.toMatch(/UPDATE sop\b/);
    expect(REPOSITORY).not.toMatch(/UPDATE plan\b/);
    expect(REPOSITORY).not.toMatch(/INSERT INTO sop\b/);
    expect(REPOSITORY).not.toMatch(/INSERT INTO plan\b/);
    // 대상 쪽 스키마에도 컬럼을 만들지 않았다.
    expect(MIGRATION).not.toMatch(/ALTER TABLE sop\b/);
    expect(MIGRATION).not.toMatch(/ALTER TABLE plan\b/);
  });

  it('가리키는 대상이 실재하는지 확인한다', () => {
    expect(REPOSITORY).toContain('targetExists');
    expect(SERVICE).toContain('this.repo.targetExists');
  });

  it('역방향 조회 경로가 있다', () => {
    expect(MIGRATION).toContain('ix_improvement_action_target');
  });
});

describe('CC-310 계약: 산출기는 하나다', () => {
  it('평가가 자기 KPI 계산기를 만들지 않았다', () => {
    // 두 번째 계산기를 만들면 대시보드와 평가서가 갈라지고, 갈라진 날 어느 쪽이
    // 참인지 말할 수 없다(ADR-43 D1).
    expect(SERVICE).toContain('computeKpi');
    expect(SERVICE).toContain('foldTaskStates');
    expect(SERVICE).toContain('applyCorrections');
  });

  it('기한을 임무 행에서 가져온다 — 없으면 지연이 언제나 0이다', () => {
    // computeKpi는 기한을 이벤트로 알 수 없다. 넘기지 않으면 평가서에
    // "지연 0%"라는 거짓이 박힌다.
    expect(REPOSITORY).toContain('listTaskDueDates');
    expect(SERVICE).toContain('listTaskDueDates');
    expect(SERVICE).not.toMatch(/dueAt: null \}\)\)/);
  });

  it('재생에 상한이 있고 잘림을 숨기지 않는다', () => {
    expect(REPOSITORY).toContain('REPLAY_LIMIT');
    expect(REPOSITORY).toContain('truncated');
  });

  it('지표를 고정하고, 낡으면 낡았다고 말한다', () => {
    // 해시를 내는 곳은 **하나**다(DB 집계). 도메인에 같은 값을 내는 함수를 두면
    // 둘이 갈라지는 날 드리프트 판정이 조용히 틀린다.
    expect(REPOSITORY).toContain('summarizeEvents');
    expect(REPOSITORY).toContain('md5(string_agg(');
    const domain = readFileSync(
      repoPath('packages', 'domain', 'src', 'evaluation', 'evaluation.ts'),
      'utf8',
    );
    expect(domain).not.toContain('export function metricBasis');
    expect(SERVICE).toContain('isMetricStale');
    expect(schemas.Evaluation.required).toContain('metricsStale');
    // 자동으로 다시 계산하지 않는다.
    expect(schemas.Evaluation.properties?.metricsStale.description).toMatch(/자동/);
  });

  it('근거가 이 훈련의 것인지 확인한다', () => {
    expect(SERVICE).toContain('이 훈련의 사실원장에 없습니다');
  });
});

describe('CC-310 계약: 확정된 평가는 얼어붙는다', () => {
  it('DB가 막는다 — 서비스 가드만으로는 다음 항목이 뚫는다', () => {
    expect(MIGRATION).toContain('une_guard_evaluation_confirmed');
    expect(MIGRATION).toContain('trg_evaluation_score_confirmed');
    expect(MIGRATION).toContain('trg_improvement_action_confirmed');
  });

  it('점수·개선조치는 고쳐 쓰지 않는다', () => {
    expect(MIGRATION).toContain('REVOKE UPDATE, DELETE ON evaluation_score FROM une_app');
    expect(MIGRATION).toContain('REVOKE UPDATE, DELETE ON improvement_action FROM une_app');
  });
});

describe('CC-310 계약: 종료 뒤 쓰기는 읽을 수 있는 오류다', () => {
  it('SIT-412-011이 계약에 있다 — 필터가 던지는 코드도 선언한다', () => {
    // `evaluation-errors.ts` 밖에서 던지므로 아래 오류코드 게이트가 보지 못한다.
    // 계약에 없으면 클라이언트가 다뤄야 할 분기를 모른다.
    const filter = readFileSync(
      repoPath('services', 'api', 'src', 'common', 'api-error.filter.ts'),
      'utf8',
    );
    expect(filter).toContain("'SIT-412-011'");
    expect(filter).toContain('isClosedSituationWrite');
    expect(JSON.stringify(doc.components.schemas.ClosedSituationNote)).toContain('SIT-412-011');
  });

  it('릴레이가 종료된 훈련의 전파를 무한 재전송하지 않는다', () => {
    // 트리거가 던진 것을 그대로 두면 배치 전체가 롤백되고 줄은 SENDING으로 남아
    // 임차가 만료될 때마다 다시 발송된다 — 바깥으로는 계속 나가면서 안에는
    // 기록이 남지 않는다.
    const relay = readFileSync(
      repoPath('services', 'worker', 'src', 'dispatch', 'outbox-relay.runner.ts'),
      'utf8',
    );
    expect(relay).toContain('isClosedSituationError');
    expect(relay).toContain("'DEAD_LETTER'");
    expect(relay).toContain("code: 'SITUATION_CLOSED'");
  });
});

describe('CC-310 계약: 오류코드 선언이 사실이다', () => {
  const defined = new Set(
    [...ERRORS.matchAll(/'((?:EVAL|SIT|COM)-\d{3}-\d{3})'/g)].map((m) => m[1]),
  );

  it('구현이 던지는 코드는 모두 선언돼 있다', () => {
    const declared = new Set<string>();
    for (const id of EVAL_OPS) {
      for (const code of (operations.get(id)?.['x-error-codes'] as string[] | undefined) ?? []) {
        declared.add(code);
      }
    }
    for (const code of defined) {
      expect(declared.has(code), `${code}가 계약에 선언되지 않았다`).toBe(true);
    }
  });

  it('계약이 선언한 코드는 모두 구현이 던진다', () => {
    const thrown = new Set([...defined, 'COM-0400', 'EVAL-400-001']);
    for (const id of EVAL_OPS) {
      for (const code of (operations.get(id)?.['x-error-codes'] as string[] | undefined) ?? []) {
        expect(thrown.has(code), `${id}이 선언한 ${code}를 구현이 던지지 않는다`).toBe(true);
      }
    }
  });

  it('정의만 있고 아무도 부르지 않는 코드가 없다', () => {
    const names = [...ERRORS.matchAll(/^ {2}([a-zA-Z]+):/gm)].map((m) => m[1]);
    const callers =
      SERVICE +
      readFileSync(
        repoPath('services', 'api', 'src', 'evaluation', 'evaluation.controller.ts'),
        'utf8',
      );
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(callers.includes(`evaluationErrors.${name}(`), `evaluationErrors.${name} 미사용`).toBe(
        true,
      );
    }
  });
});
