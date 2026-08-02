import { describe, expect, it } from 'vitest';
import {
  MOCK_TARGET_V2_CAPABILITIES,
  MOCK_TARGET_V2_PROVIDER_BUILD,
  T3Q_PLAN_FEATURE_CAPABILITIES,
  findProtectedBlockViolations,
  fromChangeProposal,
  fromEvidenceItems,
  fromValidationReport,
  guardChangeProposal,
  guardContentBlock,
  guardEvidenceSearchResponse,
  guardGenerationStatus,
  guardProviderCapabilities,
  guardValidationReport,
  isTerminalTargetV2Event,
  parseTargetV2Sse,
} from '@une/provider-adapters';
import { ajvErrors, contractValidators, loadYaml } from './contract-loader';

/**
 * CC-135 target-v2 mock 계약 왕복 테스트: 요청 계약
 * (t3q-plan-api-change-request-v1.yaml)의 응답 예제가 어댑터 가드를 통과하고
 * canonical 변환까지 도달하는지 검증한다.
 *
 * 이 파일이 증명하는 것과 증명하지 못하는 것을 분명히 한다:
 * - 증명: UNE 예제 ↔ UNE 가드/매퍼 ↔ 계약 스키마 3자 정합, 그리고 mock 정본
 *   페이로드와 계약 예제의 무드리프트.
 * - 미증명: T3Q의 실제 지원 여부. 대상 계약은 미수락이고(OB-10/OB-11) 예제는
 *   전부 UNE 작성분이다 — 전 기능은 MOCK_ONLY로 남는다(capability-governance).
 */

const V2 = ['contracts', 'openapi', 't3q-plan-api-change-request-v1.yaml'];
const doc = loadYaml(...V2);
const v2 = contractValidators(...V2);

type Json = Record<string, unknown>;

function findOperation(operationId: string): Json {
  const paths = (doc.paths ?? {}) as Record<string, Json>;
  for (const item of Object.values(paths)) {
    for (const operation of Object.values(item)) {
      if (
        operation !== null &&
        typeof operation === 'object' &&
        (operation as Json).operationId === operationId
      ) {
        return operation as Json;
      }
    }
  }
  throw new Error(`operationId not found in contract: ${operationId}`);
}

/** 응답 예제 map(name → value). 예제가 사라지면 즉시 실패한다. */
function responseExamples(
  operationId: string,
  status: string,
  mediaType = 'application/json',
): Record<string, unknown> {
  const operation = findOperation(operationId);
  const response = ((operation.responses ?? {}) as Json)[status] as Json | undefined;
  const media = ((response?.content ?? {}) as Json)[mediaType] as Json | undefined;
  const examples = media?.examples as Record<string, { value: unknown }> | undefined;
  if (!examples || Object.keys(examples).length === 0) {
    throw new Error(`no ${status} ${mediaType} examples for ${operationId}`);
  }
  return Object.fromEntries(Object.entries(examples).map(([name, ex]) => [name, ex.value]));
}

function requestExample(
  operationId: string,
  name = 'default',
  mediaType = 'application/json',
): Json {
  const operation = findOperation(operationId);
  const body = (operation.requestBody ?? {}) as Json;
  const media = ((body.content ?? {}) as Json)[mediaType] as Json | undefined;
  const examples = media?.examples as Record<string, { value: unknown }> | undefined;
  const value = examples?.[name]?.value;
  if (value === undefined) throw new Error(`no request example ${operationId}/${name}`);
  return value as Json;
}

describe('semantic edit 예제 ↔ guardChangeProposal ↔ fromChangeProposal (CR-T3Q-004)', () => {
  const examples = responseExamples('requestPlanSemanticEdit', '200');
  const request = requestExample('requestPlanSemanticEdit');
  const validate = v2.compile('ChangeProposal');

  it('RANGE/BLOCK/SECTION 3개 예제가 스키마·가드·canonical 변환을 모두 통과한다', () => {
    expect(Object.keys(examples).sort()).toEqual(['block', 'range', 'section']);
    for (const [name, value] of Object.entries(examples)) {
      expect(validate(value), `${name}: ${ajvErrors(validate)}`).toBe(true);
      const proposal = guardChangeProposal(value);
      const draft = fromChangeProposal(proposal);
      expect(draft.proposalKey, name).toBe(proposal.proposalId);
      // baseRevisionId는 요청값 에코 — 충돌 판정은 UNE가 소유한다.
      expect(draft.baseRevisionKey, name).toBe(request.baseRevisionId);
      expect(draft.operations.length, name).toBe(proposal.operations.length);
      expect(draft.proposedBlocks.length, name).toBe(proposal.proposedBlocks.length);
      for (const block of draft.proposedBlocks) {
        expect(block.blockKey, name).toBeTruthy();
        expect(block.nodeKey, name).toBeTruthy();
      }
    }
  });

  it('3개 예제 합산으로 operationType 어휘 4종이 전수 등장한다', () => {
    const types = new Set<string>();
    for (const value of Object.values(examples)) {
      for (const operation of guardChangeProposal(value).operations) {
        types.add(operation.operationType as string);
      }
    }
    expect([...types].sort()).toEqual([
      'DELETE_BLOCK',
      'INSERT_BLOCK',
      'REPLACE_BLOCK',
      'REPLACE_RANGE',
    ]);
  });

  it('어떤 예제도 요청의 protectedBlockIds를 건드리지 않는다 (재생성 금지 규칙, ADR-28 D8)', () => {
    const protectedIds = request.protectedBlockIds as string[];
    expect(protectedIds.length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(examples)) {
      expect(findProtectedBlockViolations(guardChangeProposal(value), protectedIds), name).toEqual(
        [],
      );
    }
  });

  it('보호 블록을 침범한 변형 예제는 가드가 아니라 재검사 메커니즘이 잡아낸다', () => {
    // 가드는 형태만 본다 — 침범 탐지는 findProtectedBlockViolations의 책임이다.
    const proposal = guardChangeProposal(examples.block);
    const targetId = proposal.operations[0].targetId as string;
    expect(findProtectedBlockViolations(proposal, [targetId])).toEqual([targetId]);
  });
});

describe('evidence 예제 ↔ guardEvidenceSearchResponse ↔ fromEvidenceItems (CR-T3Q-005)', () => {
  const examples = responseExamples('searchPlanEvidence', '200');
  const request = requestExample('searchPlanEvidence');

  it('예제가 가드를 통과하고 provenance가 canonical 슬롯으로 옮겨진다', () => {
    const response = guardEvidenceSearchResponse(examples.default);
    // requestId 에코 — 어댑터가 불일치 시 T3Q_RESPONSE_CONTRACT_VIOLATION으로 막는 지점.
    expect(response.requestId).toBe(request.requestId);
    expect(response.items.length).toBeGreaterThan(1);

    const citation = v2.compile('Citation');
    for (const item of response.items) {
      expect(citation(item), ajvErrors(citation)).toBe(true);
    }
    // 점수 내림차순(예제 주석의 계약 서술)이 실제로 지켜진다.
    const scores = response.items.map((item) => item.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);

    const drafts = fromEvidenceItems(response.items);
    expect(drafts.length).toBe(response.items.length);
    expect(drafts[0]).toMatchObject({
      sourceRef: response.items[0].citationId,
      documentId: response.items[0].documentId,
      page: String(response.items[0].page),
      supportsBlockKeys: response.items[0].supportsBlockIds,
    });
    expect(drafts[0].retrievedAt).toBe(response.items[0].retrievedAt);
    expect(request.topK as number).toBeGreaterThanOrEqual(response.items.length);
  });
});

describe('validation 예제 ↔ guardValidationReport ↔ fromValidationReport (CR-T3Q-006)', () => {
  const examples = responseExamples('validatePlanSemanticContent', '200');

  it('invalid 예제가 가드를 통과하고 severity 3종이 canonical 이슈로 보존된다', () => {
    const issue = v2.compile('ValidationIssue');
    for (const raw of (examples.invalid as Json).issues as unknown[]) {
      expect(issue(raw), ajvErrors(issue)).toBe(true);
    }
    const report = guardValidationReport(examples.invalid);
    expect(report.valid).toBe(false);
    expect(report.issues.some((entry) => entry.severity === 'ERROR')).toBe(true);
    expect(new Set(report.issues.map((entry) => entry.severity))).toEqual(
      new Set(['ERROR', 'WARNING', 'INFO']),
    );

    const draft = fromValidationReport(report);
    expect(draft.valid).toBe(false);
    expect(draft.issues.map((entry) => entry.issueKey)).toEqual(
      report.issues.map((entry) => entry.issueId),
    );
    // 계약이 type을 개방 문자열로 두므로 canonical 변환도 값을 그대로 보존한다.
    expect(draft.issues.map((entry) => entry.type)).toEqual(report.issues.map((e) => e.type));
    expect(draft.issues[0].nodeKey).toBe(report.issues[0].sectionId ?? null);
    expect(draft.issues[0].suggestedAction).toBeTruthy();
  });
});

describe('job 예제 ↔ guardGenerationStatus (CR-T3Q-003)', () => {
  const statusExamples = responseExamples('getGenerationJob', '200');
  const cancelExamples = responseExamples('cancelGenerationJob', '200');

  it('폴링 4종 + 취소 1종 예제가 스키마와 가드를 모두 통과한다', () => {
    expect(Object.keys(statusExamples).sort()).toEqual([
      'completed',
      'failed',
      'partial',
      'running',
    ]);
    const validate = v2.compile('GenerationStatus');
    const observed = new Set<string>();
    for (const [name, value] of Object.entries({ ...statusExamples, ...cancelExamples })) {
      expect(validate(value), `${name}: ${ajvErrors(validate)}`).toBe(true);
      const status = guardGenerationStatus(value);
      observed.add(status.status);
      expect(status.progress, name).toBeGreaterThanOrEqual(0);
      expect(status.progress, name).toBeLessThanOrEqual(100);
    }
    expect([...observed].sort()).toEqual([
      'CANCELLED',
      'COMPLETED',
      'FAILED',
      'PARTIAL',
      'RUNNING',
    ]);
  });

  it('취소는 실패가 아니다 — 진행분 보존, failedTargetIds 비고 error null', () => {
    const cancelled = guardGenerationStatus(cancelExamples.cancelled);
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.completedTargetIds.length).toBeGreaterThan(0);
    expect(cancelled.failedTargetIds).toEqual([]);
    expect((cancelExamples.cancelled as Json).error).toBeNull();
  });

  it('PARTIAL은 실패 대상을 드러내고 FAILED는 ErrorResponse를 싣는다', () => {
    const partial = guardGenerationStatus(statusExamples.partial);
    expect(partial.failedTargetIds.length).toBeGreaterThan(0);

    const failed = statusExamples.failed as Json;
    const error = v2.compile('ErrorResponse');
    expect(error(failed.error), ajvErrors(error)).toBe(true);
    expect(guardGenerationStatus(failed).status).toBe('FAILED');
  });
});

describe('SSE 전사 예제 ↔ parseTargetV2Sse (CR-T3Q-003, 프레이밍은 UNE 가정 OB-10)', () => {
  const examples = responseExamples('streamGenerationEvents', '200', 'text/event-stream');

  it('전사가 파싱되고 heartbeat는 건너뛰며 마지막 프레임이 종결 이벤트다', () => {
    const transcript = examples.transcript;
    expect(typeof transcript).toBe('string');
    const frames = parseTargetV2Sse(transcript as string);
    expect(frames.length).toBe(3);
    expect(frames.map((frame) => frame.id)).toEqual([1, 2, 3]);
    expect(frames.map((frame) => frame.event)).toEqual([
      'job.started',
      'content.block',
      'job.completed',
    ]);
    const last = frames[frames.length - 1];
    expect(isTerminalTargetV2Event(last.event)).toBe(true);
    expect(['job.completed', 'job.failed']).toContain(last.event);
  });

  it('content.block 프레임의 블록은 ContentBlock 스키마와 응답 가드를 통과한다', () => {
    const frames = parseTargetV2Sse(examples.transcript as string);
    const block = frames.find((frame) => frame.event === 'content.block')?.data.block;
    expect(block).toBeDefined();
    const validate = v2.compile('ContentBlock');
    expect(validate(block), ajvErrors(validate)).toBe(true);
    expect(guardContentBlock(block, '/block').blockType).toBe('BULLET');
  });
});

describe('capabilities 예제 ↔ MOCK_TARGET_V2_CAPABILITIES (CR-T3Q-009)', () => {
  const examples = responseExamples('getPlanProviderCapabilities', '200');

  it('mock 예제 value가 mock 정본과 deep-equal이다 (드리프트 즉시 실패)', () => {
    expect(examples.mock).toEqual(MOCK_TARGET_V2_CAPABILITIES);
  });

  it('예제가 스키마와 가드를 통과하고 providerBuild가 T3Q 빌드로 오독될 수 없다', () => {
    const validate = v2.compile('ProviderCapabilities');
    expect(validate(examples.mock), ajvErrors(validate)).toBe(true);
    const capabilities = guardProviderCapabilities(examples.mock);
    expect(capabilities.providerBuild).toBe(MOCK_TARGET_V2_PROVIDER_BUILD);
    expect(capabilities.providerBuild.startsWith('une-mock-')).toBe(true);
    expect(capabilities.contractVersions).toEqual(['2.0']);
  });

  it('features 키 집합이 계약 스키마와 일치하고, 각 플래그가 레지스트리 mockAvailable과 일치한다', () => {
    const schemas = (doc.components as { schemas: Record<string, unknown> }).schemas;
    const contractKeys = Object.keys(
      (schemas.ProviderCapabilities as { properties: { features: { properties: Json } } })
        .properties.features.properties,
    ).sort();
    const features = MOCK_TARGET_V2_CAPABILITIES.features as Record<string, boolean>;
    expect(Object.keys(features).sort()).toEqual(contractKeys);

    // 계약 features 키는 전부 레지스트리에 있어야 하고(기존 두 방향 동기 규칙은
    // capability-governance가 소유), 플래그 값은 "이 mock이 실제로 구현했는가"와
    // 같아야 한다 — mock 미구현을 true로 광고하면 즉시 실패한다.
    for (const [key, flag] of Object.entries(features)) {
      const entry = T3Q_PLAN_FEATURE_CAPABILITIES.find((item) => item.featureId === key);
      expect(entry, `${key} 레지스트리 등록`).toBeDefined();
      expect(entry?.mockAvailable, `${key} mockAvailable`).toBe(flag);
    }
    expect(features.referenceUpload).toBe(false);
  });
});
