import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_SET_STATUSES,
  KNOWLEDGE_DOCUMENT_STATUSES,
  KNOWLEDGE_DOCUMENT_TYPES,
  MAX_TOP_K,
  RETENTION_SCOPES,
  UNI_PROCESSING_STATUSES,
} from '@une/domain';
import { loadYaml, repoPath } from './contract-loader';

/**
 * CC-220 계약 게이트 — 어휘가 마이그레이션·도메인·계약 세 곳에서 같은가.
 *
 * CC-200이 이 게이트를 만든 이유가 그대로 여기에도 적용된다: 어휘를 세 곳에
 * 나눠 적으면 한 곳만 바뀌어도 조용히 어긋난다. 실제로 ADR-34 기록에 그 사고가
 * 남아 있다 — 0025가 `SUPERSEDED`를 더했는데 게이트가 마이그레이션 한 파일만
 * 읽어 초록으로 통과했다.
 *
 * CC-220은 어휘를 **네 개** 새로 만들었고(등록 축·UNI 처리 축·자료 종류·
 * 보존범위) 착수 시점에는 이 대조가 없었다(QA 검토 m4/F7).
 */
const CONTRACT = ['contracts', 'openapi', 'une-platform-api-v1.yaml'] as const;
const MIGRATIONS_DIR = repoPath('database', 'migrations');

interface Schema {
  type?: string | string[];
  enum?: string[];
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean;
  nullable?: boolean;
  maximum?: number;
  $ref?: string;
}

const doc = loadYaml(...CONTRACT) as {
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

const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR)
  .filter((name) => /^\d{4}_.*\.sql$/.test(name))
  .sort();

/** 제약을 **마지막으로 정의한** 마이그레이션에서 읽는다(CC-200 게이트와 같은 규칙). */
function checkValues(constraint: string): string[] {
  const defining = [...MIGRATION_FILES]
    .reverse()
    .find((name) =>
      readFileSync(join(MIGRATIONS_DIR, name), 'utf8').includes(`ADD CONSTRAINT ${constraint}`),
    );
  if (!defining) throw new Error(`제약 ${constraint}을 어느 마이그레이션에서도 찾지 못했다`);
  const sql = readFileSync(join(MIGRATIONS_DIR, defining), 'utf8');
  const anchor = sql.lastIndexOf(`ADD CONSTRAINT ${constraint}`);
  const slice = sql.slice(anchor, anchor + 800);
  // `IN` 연산자 뒤의 첫 `(` 부터 읽는다. CC-200 게이트는 `IN (` 리터럴을
  // 찾는데, 값이 많아 **줄을 바꾼** 제약(uni_status·document_type)에서는 그
  // 위치를 놓친다. 그러면 뒤에 나오는 다른 IN 목록을 읽어 조용히 엉뚱한
  // 어휘를 비교하게 되므로, 연산자와 괄호를 따로 찾는다.
  const inIdx = slice.indexOf(' IN');
  const open = inIdx < 0 ? -1 : slice.indexOf('(', inIdx);
  const close = open < 0 ? -1 : slice.indexOf(')', open);
  if (open < 0 || close < 0) throw new Error(`제약 ${constraint}의 IN 목록을 읽지 못했다`);
  return [...slice.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const KNOW_OPS = ['UNE-KNOW-001', 'UNE-KNOW-002', 'UNE-KNOW-003'] as const;
const EVIDENCE_OPS = ['UNE-KNOW-004', 'UNE-KNOW-005', 'UNE-KNOW-006', 'UNE-KNOW-007'] as const;

describe('CC-220 계약: 어휘가 마이그레이션·도메인·계약과 같다', () => {
  it('등록 축 5종', () => {
    const fromDb = checkValues('ck_knowledge_document_status');
    expect(fromDb).toEqual([...KNOWLEDGE_DOCUMENT_STATUSES]);
    expect(schemas.KnowledgeDocument.properties?.status.enum).toEqual(fromDb);
  });

  it('UNI 처리 축 6종', () => {
    const fromDb = checkValues('ck_knowledge_document_uni_status');
    expect(fromDb).toEqual([...UNI_PROCESSING_STATUSES]);
    expect(schemas.KnowledgeDocument.properties?.uniStatus.enum).toEqual(fromDb);
  });

  it('자료 종류 5종 — 요청과 응답이 같은 목록을 쓴다', () => {
    const fromDb = checkValues('ck_knowledge_document_type');
    expect(fromDb).toEqual([...KNOWLEDGE_DOCUMENT_TYPES]);
    expect(schemas.KnowledgeDocument.properties?.documentType.enum).toEqual(fromDb);
    expect(schemas.KnowledgeDocumentCreateRequest.properties?.documentType.enum).toEqual(fromDb);
  });

  it('보존범위 3종', () => {
    const fromDb = checkValues('ck_knowledge_document_retention_scope');
    expect(fromDb).toEqual([...RETENTION_SCOPES]);
    expect(schemas.KnowledgeDocument.properties?.retentionScope.enum).toEqual(fromDb);
    expect(schemas.KnowledgeDocumentCreateRequest.properties?.retentionScope.enum).toEqual(fromDb);
  });

  it('두 축은 값이 겹치지 않는다', () => {
    // 겹치면 문자열만 보고 "우리가 아는 사실"과 "UNI가 알려준 사실"을 구분할 수
    // 없다. 도메인 테스트에도 같은 단언이 있지만 계약 쪽 enum이 따로 흐를 수
    // 있으므로 여기서도 본다.
    const reg = schemas.KnowledgeDocument.properties?.status.enum ?? [];
    const uni = schemas.KnowledgeDocument.properties?.uniStatus.enum ?? [];
    expect(reg.filter((v) => uni.includes(v))).toEqual([]);
  });
});

describe('CC-220 계약: 오류코드 선언이 사실이다', () => {
  const implSource = readFileSync(
    repoPath('services', 'api', 'src', 'knowledge', 'knowledge-errors.ts'),
    'utf8',
  );
  const thrown = new Set(
    [...implSource.matchAll(/ApiError\(\s*\d{3},\s*'([A-Z0-9-]+)'/g)].map((m) => m[1]),
  );

  it('구현이 던지는 KNOW/UNI 코드는 모두 어느 KNOW 오퍼레이션엔가 선언돼 있다', () => {
    const declared = new Set<string>();
    for (const id of KNOW_OPS) {
      for (const code of (operations.get(id)?.['x-error-codes'] as string[] | undefined) ?? []) {
        declared.add(code);
      }
    }
    for (const code of thrown) {
      expect(declared.has(code), `${code}가 계약에 선언되지 않았다`).toBe(true);
    }
  });

  it('계약이 선언한 KNOW/UNI 코드는 모두 구현이 던진다', () => {
    // ADR-33 D17이 `PROV-503-001`에서 내린 결론이다 — 던지지 않는 코드를
    // 남겨 두면 그 목록이 검증 가능한 사실이 아니게 된다. CC-220 착수 시점에
    // `UNI-503-001`이 정확히 그 상태였다(UNE-KNOW-002는 UNI를 부르지 않는다).
    for (const id of KNOW_OPS) {
      const declared = (operations.get(id)?.['x-error-codes'] as string[] | undefined) ?? [];
      for (const code of declared) {
        // 공통 코드(COM-*)는 인터셉터·경로검증이 던지므로 이 파일에 없다.
        if (code.startsWith('COM-')) continue;
        expect(thrown.has(code), `${id}이 선언한 ${code}를 구현이 던지지 않는다`).toBe(true);
      }
    }
  });

  it('멱등 필수 오퍼레이션은 COM-0400과 COM-0409를 선언한다', () => {
    // 두 코드는 인터셉터가 던진다(키 누락 400, 페이로드 불일치·진행중 409).
    // 선언하지 않으면 클라이언트가 그 응답을 예상할 수 없다.
    for (const id of ['UNE-KNOW-001', 'UNE-KNOW-003'] as const) {
      const declared = (operations.get(id)?.['x-error-codes'] as string[] | undefined) ?? [];
      expect(declared, id).toContain('COM-0400');
      expect(declared, id).toContain('COM-0409');
    }
  });

  it('경로 파라미터를 받는 오퍼레이션은 COM-0400을 선언한다', () => {
    for (const id of KNOW_OPS) {
      const declared = (operations.get(id)?.['x-error-codes'] as string[] | undefined) ?? [];
      expect(declared, id).toContain('COM-0400');
    }
  });
});

describe('CC-220 계약: 응답 스키마가 닫혀 있다', () => {
  it('요청 스키마는 알 수 없는 필드를 받지 않는다', () => {
    // 컨트롤러가 `rejectUnknownKeys`로 400을 내므로 계약도 같은 말을 해야 한다.
    for (const name of ['KnowledgeDocumentCreateRequest', 'KnowledgeDocumentRetryRequest']) {
      expect(schemas[name].additionalProperties, name).toBe(false);
    }
  });

  it('UNE-KNOW-001/003은 202이고 002는 200이다', () => {
    // 202가 아니라 201이면 "등록이 끝났다"로 읽힌다 — 실제로 끝난 것은 접수다.
    for (const id of ['UNE-KNOW-001', 'UNE-KNOW-003'] as const) {
      const responses = operations.get(id)?.responses as Record<string, unknown>;
      expect(Object.keys(responses), id).toContain('202');
      expect(Object.keys(responses), id).not.toContain('201');
    }
    const get = operations.get('UNE-KNOW-002')?.responses as Record<string, unknown>;
    expect(Object.keys(get)).toContain('200');
  });

  it('세 오퍼레이션 모두 KnowledgeDocument를 돌려준다 (placeholder가 남아 있지 않다)', () => {
    for (const id of KNOW_OPS) {
      const responses = operations.get(id)?.responses as Record<string, Record<string, unknown>>;
      const body = JSON.stringify(responses);
      expect(body, id).toContain('KnowledgeDocumentResponse');
      expect(body, id).not.toContain('GenericResponse');
    }
  });

  it('UNI 처리 축은 nullable이다 ("아직 모른다"를 표현할 수 있어야 한다)', () => {
    expect(schemas.KnowledgeDocument.properties?.uniStatus.nullable).toBe(true);
    expect(schemas.KnowledgeDocument.required).toContain('uniStatus');
  });
});

describe('CC-230 계약: EvidenceSet 어휘와 오류코드', () => {
  const implSource = readFileSync(
    repoPath('services', 'api', 'src', 'knowledge', 'evidence-errors.ts'),
    'utf8',
  );
  const thrown = new Set(
    [...implSource.matchAll(/ApiError\(\s*\d{3},\s*'([A-Z0-9-]+)'/g)].map((m) => m[1]),
  );

  it('EvidenceSet 상태 2종이 마이그레이션·도메인·계약에서 같다', () => {
    const fromDb = checkValues('ck_evidence_set_status');
    expect(fromDb).toEqual([...EVIDENCE_SET_STATUSES]);
    expect(schemas.EvidenceSet.properties?.status.enum).toEqual(fromDb);
  });

  it('화면 흐름 상태가 계약 enum에 새어 들어오지 않는다', () => {
    // US-SIT-011의 아홉 상태 중 저장 대상은 둘뿐이다(ADR-37 D1). 나머지가
    // 계약에 들어오면 화면이 그것을 서버 상태로 착각한다.
    const declared = schemas.EvidenceSet.properties?.status.enum ?? [];
    for (const screenOnly of ['SEARCHING', 'RESULTS_READY', 'NO_RESULTS', 'EVIDENCE_CONFLICT']) {
      expect(declared, screenOnly).not.toContain(screenOnly);
    }
  });

  it('topK 상한이 도메인·계약·마이그레이션에서 같다', () => {
    const req = schemas.EvidenceSearchRequest.properties?.topK;
    expect(req?.maximum).toBe(MAX_TOP_K);
    // 0031의 CHECK도 같은 상한이어야 한다 — 계약만 넓히면 DB가 23514를 낸다.
    const sql = readFileSync(join(MIGRATIONS_DIR, '0031_evidence_set_and_items.sql'), 'utf8');
    expect(sql).toContain(`top_k BETWEEN 1 AND ${MAX_TOP_K}`);
  });

  it('구현이 던지는 EVID/UNI 코드는 모두 계약에 선언돼 있다', () => {
    const declared = new Set<string>();
    for (const id of EVIDENCE_OPS) {
      for (const code of (operations.get(id)?.['x-error-codes'] as string[] | undefined) ?? []) {
        declared.add(code);
      }
    }
    for (const code of thrown) {
      expect(declared.has(code), `${code}가 계약에 선언되지 않았다`).toBe(true);
    }
  });

  it('계약이 선언한 EVID/UNI 코드는 모두 구현이 던진다', () => {
    for (const id of EVIDENCE_OPS) {
      for (const code of (operations.get(id)?.['x-error-codes'] as string[] | undefined) ?? []) {
        if (code.startsWith('COM-')) continue;
        expect(thrown.has(code), `${id}이 선언한 ${code}를 구현이 던지지 않는다`).toBe(true);
      }
    }
  });

  it('placeholder가 남아 있지 않다', () => {
    // UNE-KNOW-004는 착수 시점에 응답이 `Situation`이었다(placeholder 시절의
    // 흔적). 005~007은 GenericResponse였다.
    for (const id of EVIDENCE_OPS) {
      const body = JSON.stringify(operations.get(id)?.responses);
      expect(body, id).not.toContain('GenericResponse');
      expect(body, id).not.toContain("schemas/Situation'");
    }
  });

  it('검색은 200이다 (동기 호출 — 202가 아니다)', () => {
    const search = operations.get('UNE-KNOW-004')?.responses as Record<string, unknown>;
    expect(Object.keys(search)).toContain('200');
    expect(Object.keys(search)).not.toContain('202');
  });

  it('요청 스키마는 알 수 없는 필드를 받지 않는다', () => {
    for (const name of ['EvidenceSearchRequest', 'EvidenceLockRequest']) {
      expect(schemas[name].additionalProperties, name).toBe(false);
    }
  });

  it('기준 판을 요청이 명시하게 한다', () => {
    // 생략을 허용하면 서버가 "지금 최신"으로 채우고, 사용자가 본 판과 달라질
    // 수 있다. EvidenceSet은 동결되므로 그 어긋남이 굳는다(ADR-34 D17과 같은 축).
    expect(schemas.EvidenceSearchRequest.required).toContain('snapshotId');
  });

  it('버린 청크 수를 응답이 알려준다 (조용히 버리지 않는다)', () => {
    expect(schemas.EvidenceSet.required).toContain('rejectedChunkCount');
  });
});

describe('CC-230 계약: 오류코드의 HTTP 상태가 responses에 선언돼 있다', () => {
  // 검토 F5. `x-error-codes`에 EVID-412-001이 있는데 responses에 412가 없었다.
  // 계약을 읽는 클라이언트는 412를 예상할 수 없고, 기존 게이트는 코드 문자열만
  // 대조해 이것을 보지 못했다.
  const sources = ['knowledge-errors.ts', 'evidence-errors.ts'].map((f) =>
    readFileSync(repoPath('services', 'api', 'src', 'knowledge', f), 'utf8'),
  );
  const statusByCode = new Map<string, string>();
  for (const src of sources) {
    for (const m of src.matchAll(/ApiError\(\s*(\d{3}),\s*'([A-Z0-9-]+)'/g)) {
      statusByCode.set(m[2], m[1]);
    }
  }

  it('모든 KNOW/EVID 오퍼레이션이 자신이 던지는 상태를 선언한다', () => {
    for (const id of [...KNOW_OPS, ...EVIDENCE_OPS]) {
      const op = operations.get(id);
      const declared = (op?.['x-error-codes'] as string[] | undefined) ?? [];
      const responses = Object.keys((op?.responses as Record<string, unknown>) ?? {});
      for (const code of declared) {
        const status = statusByCode.get(code);
        if (!status) continue; // COM-* 등 공통 코드는 이 파일들에 없다
        expect(responses, `${id}: ${code}(${status})`).toContain(status);
      }
    }
  });
});
