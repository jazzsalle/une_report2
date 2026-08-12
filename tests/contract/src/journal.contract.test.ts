import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JOURNAL_SECTIONS, JOURNAL_STATUSES, NARRATIVE_SOURCES } from '@une/domain';
import { loadYaml, repoPath } from './contract-loader';

/**
 * CC-300 계약 게이트 — 상황일지.
 *
 * 지키는 것 넷.
 *   (1) **사실칸에 닿는 경로가 하나도 없다** — 대조(도메인)는 구조적 분리가
 *       하드 불변식일 때만 뜻이 있다.
 *   (2) **AI는 사실을 반박하면 반영되지 않는다**(fail-closed), 사람은 경고만.
 *   (3) 일지가 문서다 — 리비전·Export의 두 번째 경로를 만들지 않았다.
 *   (4) LLM을 자체로 만들지 않았고, 시뮬레이션임을 숨기지 않는다.
 */
const MIGRATIONS_DIR = repoPath('database', 'migrations');

interface Schema {
  enum?: string[];
  format?: string;
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean;
  items?: Schema;
  allOf?: Schema[];
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

const JNL_OPS = [
  'UNE-JNL-005',
  'UNE-JNL-006',
  'UNE-JNL-007',
  'UNE-JNL-008',
  'UNE-JNL-009',
  'UNE-JNL-010',
  'UNE-JNL-011',
] as const;

const MIGRATION = readFileSync(
  join(MIGRATIONS_DIR, '0042_journal_projection_and_review.sql'),
  'utf8',
);
const SERVICE = readFileSync(
  repoPath('services', 'api', 'src', 'journal', 'journal.service.ts'),
  'utf8',
);
const REPOSITORY = readFileSync(
  repoPath('services', 'api', 'src', 'journal', 'journal.repository.ts'),
  'utf8',
);
const CONTROLLER = readFileSync(
  repoPath('services', 'api', 'src', 'journal', 'journal.controller.ts'),
  'utf8',
);
const ERRORS = readFileSync(
  repoPath('services', 'api', 'src', 'journal', 'journal-errors.ts'),
  'utf8',
);
const DOMAIN = readFileSync(
  repoPath('packages', 'domain', 'src', 'journal', 'journal-projection.ts'),
  'utf8',
);

describe('CC-300 계약: 사실칸에 닿는 경로가 없다', () => {
  it('저장소에 사실칸을 바꾸는 UPDATE가 없다', () => {
    // 구조적 분리가 하드 불변식이어야 대조가 뜻을 갖는다.
    expect(REPOSITORY).toContain('updateNarrative');
    const narrative = REPOSITORY.slice(REPOSITORY.indexOf('async updateNarrative'));
    const sql = narrative.slice(0, narrative.indexOf('async refreshProjectionItem'));
    expect(sql).not.toContain('fact_payload_json');
    expect(sql).not.toContain('locked_fields_json');
  });

  it('사실칸을 건드리는 편집 요청을 거절한다', () => {
    expect(SERVICE).toContain('touchesLockedFacts');
    expect(SERVICE).toContain('journalErrors.factLocked');
  });

  it('문서 IR의 사실 블록이 잠긴 채로 만들어진다', () => {
    // CC-150 변경집합 검증기가 이미 LOCKED_BLOCK을 거절하므로 방어가 두 겹이다.
    expect(SERVICE).toContain('editState: { editedByUser: false, locked: true }');
  });

  it('승인된 일지는 DB가 얼린다', () => {
    expect(MIGRATION).toContain('trg_journal_approved');
    expect(MIGRATION).toContain('trg_journal_projection_item_approved');
    expect(MIGRATION).toContain('trg_journal_approval_append_only');
  });
});

describe('CC-300 계약: AI에는 fail-closed, 사람에게는 경고', () => {
  it('제안이 사실을 반박하면 반영하지 않는다', () => {
    const propose = SERVICE.slice(SERVICE.indexOf('async proposeNarratives('));
    const body = propose.slice(0, propose.indexOf('async editNarratives('));
    expect(body).toContain('findFactContradictions');
    expect(body).toContain('journalErrors.proposalRejected');
    // **규칙은 도메인이 갖는다.** 지금 붙은 어댑터는 사실에서만 문장을 만들어
    // 반박이 구조적으로 없으므로 이 분기는 E2E로 증명할 수 없다(OB-03).
    // 조건식을 서비스 안에 베껴 두면 시험할 수 없는 자리에 규칙이 숨는다 —
    // 이름 붙여 도메인에 두고 단위 시험이 그것을 잡는다.
    expect(body).toContain('acceptProposal({');
    expect(DOMAIN).toMatch(/contradictions\.length > 0\) return false/);
  });

  it('사람이 쓴 문장을 AI가 덮지 않는다', () => {
    // "User-edited blocks are protected from regeneration".
    expect(DOMAIN).toMatch(/narrativeSource !== 'USER'/);
    const refresh = REPOSITORY.slice(REPOSITORY.indexOf('async refreshProjectionItem'));
    expect(refresh.slice(0, 1500)).toContain("narrative_source = 'USER'");
  });

  it('거절 규칙에 단위 시험이 붙어 있다', () => {
    // E2E가 증명할 수 없는 분기다. 시험이 없으면 실 어댑터가 오는 날 처음
    // 도는 코드가 되고, 그때 처음 검증하는 것은 늦다.
    const domainTest = readFileSync(
      repoPath('packages', 'domain', 'src', 'journal', 'journal-projection.test.ts'),
      'utf8',
    );
    expect(domainTest).toContain('acceptProposal(');
    expect(domainTest).toMatch(/fail-closed/);
  });

  it('사람 편집은 막지 않고 경고만 단다', () => {
    // 오탐으로 편집을 막으면 사람이 우회로를 찾는다.
    const edit = SERVICE.slice(SERVICE.indexOf('async editNarratives('));
    const body = edit.slice(0, edit.indexOf('async refreshFacts('));
    expect(body).not.toContain('proposalRejected');
    expect(schemas.JournalFactCell.required).toContain('contradictions');
  });

  it('대조가 닫힌 집합에서 역탐색한다', () => {
    // 한국어 텍스트에서 수치를 열린 집합으로 뽑으면 오탐이 쏟아진다.
    expect(DOMAIN).toContain('FIELD_PHRASES');
    expect(DOMAIN).toContain('findFactContradictions');
  });
});

describe('CC-300 계약: 일지는 문서다', () => {
  it('journal_revision·journal_section을 만들지 않았다', () => {
    // 설계 10이 이름을 쓰지만 CC-150의 것이 그 자리다(ADR-33 D4·ADR-41 D6과 같은 형태).
    expect(MIGRATION).not.toMatch(/CREATE TABLE[^\n]*journal_revision/i);
    expect(MIGRATION).not.toMatch(/CREATE TABLE[^\n]*journal_section/i);
    expect(MIGRATION).not.toMatch(/CREATE TABLE[^\n]*ai_edit_proposal/i);
  });

  it('만든 테이블은 검토·승인 둘뿐이다', () => {
    const created = [...MIGRATION.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
    expect(created.sort()).toEqual(['journal_approval', 'journal_review_request']);
  });

  it('Export는 CC-160 경로에 위임한다', () => {
    // 두 번째 Export 경로를 만들면 Track A 검증을 우회할 수 있게 된다.
    expect(CONTROLLER).toContain('this.exports.requestExport');
    expect(SERVICE).toContain('exportPrecondition');
  });

  it('섹션 key가 문서 블록 key와 같다는 것을 DB가 적는다', () => {
    expect(MIGRATION).toContain('stable_block_key');
  });
});

describe('CC-300 계약: LLM을 만들지 않았다', () => {
  it('어댑터가 스스로 시뮬레이션임을 밝힌다', () => {
    const port = readFileSync(
      repoPath('packages', 'provider-adapters', 'src', 'journal', 'journal-narrative-port.ts'),
      'utf8',
    );
    expect(port).toContain('isSimulated');
    expect(port).toContain('OB-03');
    const adapter = readFileSync(
      repoPath(
        'packages',
        'provider-adapters',
        'src',
        'journal',
        'simulation-narrative-adapter.ts',
      ),
      'utf8',
    );
    expect(adapter).toContain('readonly isSimulated = true');
  });

  it('응답이 시뮬레이션 여부를 싣는다', () => {
    expect(schemas.NarrativeProposal.required).toContain('simulated');
    expect(schemas.NarrativeProposal.properties?.simulated.description).toMatch(/OB-03/);
  });

  it('제안 값이 사실에서만 온다', () => {
    // 어댑터가 문장을 지어내면 그것이 사실 출처가 된다.
    const adapter = readFileSync(
      repoPath(
        'packages',
        'provider-adapters',
        'src',
        'journal',
        'simulation-narrative-adapter.ts',
      ),
      'utf8',
    );
    expect(adapter).toContain('describeFacts');
    // 실제 호출이 없다는 것을 본다 — 주석의 'LLM이 아니다'까지 잡으면 안 된다.
    expect(adapter).not.toMatch(/fetch\(|https?:\/\//i);
  });
});

describe('CC-300 계약: 어휘가 세 곳에서 같다', () => {
  it('일지 상태 4종 — 투영이 동기라 CONFIGURING·PROJECTING이 없다', () => {
    const defining = MIGRATION.slice(MIGRATION.indexOf('ck_journal_status'));
    const values = [...defining.slice(0, 300).matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(values).toEqual([...JOURNAL_STATUSES]);
    expect(schemas.JournalStatus.enum).toEqual([...JOURNAL_STATUSES]);
    for (const ghost of ['CONFIGURING', 'PROJECTING']) {
      expect(values, ghost).not.toContain(ghost);
    }
  });

  it('섹션 어휘가 계약과 같다', () => {
    expect(schemas.JournalSection.enum).toEqual([...JOURNAL_SECTIONS]);
  });

  it('서술 출처 3종이 DB·도메인·계약에서 같다', () => {
    const defining = MIGRATION.slice(MIGRATION.indexOf('ck_journal_narrative_source'));
    const values = [...defining.slice(0, 250).matchAll(/'([A-Z]+)'/g)].map((m) => m[1]);
    expect(values).toEqual([...NARRATIVE_SOURCES]);
    expect(schemas.JournalFactCell.properties?.narrativeSource.enum).toEqual([
      ...NARRATIVE_SOURCES,
    ]);
  });
});

describe('CC-300 계약: 자리표시자가 남아 있지 않다', () => {
  it('일곱 오퍼레이션이 실제 스키마를 가리킨다', () => {
    for (const id of JNL_OPS) {
      const op = operations.get(id);
      expect(op, id).toBeDefined();
      const responses = op?.responses as Record<
        string,
        { content?: Record<string, { schema?: Schema }> }
      >;
      const success = responses['200'] ?? responses['201'] ?? responses['202'];
      const schema = success?.content?.['application/json']?.schema;
      expect(schema, `${id} 응답`).toBeDefined();
      const name = schema?.$ref?.split('/').pop() ?? schema?.items?.$ref?.split('/').pop();
      expect(name, id).toBeDefined();
      // CC-300이 정의한 스키마만 닫힘을 요구한다. `ExportJobResource`는 CC-160의
      // 것이고 그 항목의 규칙을 따른다 — 남의 스키마를 여기서 다시 규정하지 않는다.
      if ((name as string).startsWith('Journal') || (name as string) === 'NarrativeProposal') {
        expect(schemas[name as string]?.additionalProperties, `${id} → ${name}`).toBe(false);
      }
    }
  });

  it('요청 스키마가 전부 닫혀 있다', () => {
    for (const id of JNL_OPS) {
      const body = operations.get(id)?.requestBody as
        { content: Record<string, { schema: { $ref?: string } }> } | undefined;
      if (!body) continue;
      const name = body.content['application/json'].schema.$ref?.split('/').pop() as string;
      expect(name, id).toMatch(/^Journal.*Request$/);
      expect(schemas[name]?.additionalProperties, `${id} 요청 ${name}`).toBe(false);
    }
  });

  it('드리프트를 응답이 밝힌다', () => {
    // 최신인 척하는 오래된 일지가 오래된 일지보다 위험하다.
    expect(schemas.JournalResource.required).toEqual(
      expect.arrayContaining(['drifted', 'currentProjectionHash']),
    );
  });
});

describe('CC-300 계약: 일지는 양식 위에서 시작한다', () => {
  it('templateFileId는 선택 항목이 아니다', () => {
    // 원본 패키지가 없는 문서는 CC-160 보존 Export가 거절한다. 양식을 선택으로
    // 두면 "만들 수는 있는데 내보낼 수 없는 일지"가 생기고, 그 사실은 승인
    // 뒤에야 드러난다(설계 06 US-SIT-030 3단계 / US-SIT-034 4단계).
    const schema = schemas.JournalProjectionRequest;
    expect(schema.required).toContain('templateFileId');
    expect(schema.properties?.templateFileId.format).toBe('uuid');
    expect(schema.properties?.templateId).toBeUndefined();
  });

  it('일지 리비전 출처 PROJECTION이 계약에 있다', () => {
    // 문장 단위로 출처를 밝히면서(narrative_source) 판 단위에서 뭉뚱그리면
    // 원칙이 한 층 위에서 깨진다(0043).
    expect(schemas.RevisionOrigin.enum).toContain('PROJECTION');
  });
});

describe('CC-300 계약: 오류코드 선언이 사실이다', () => {
  const callers = [SERVICE, CONTROLLER].join('\n');
  const defined = [...ERRORS.matchAll(/ApiError\(\s*\d{3},\s*'([A-Z0-9-]+)'/g)].map((m) => m[1]);

  it('정의만 있고 아무도 부르지 않는 코드가 없다', () => {
    const names = [...ERRORS.matchAll(/^ {2}([a-zA-Z]+): \(/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(callers.includes(`journalErrors.${name}(`), `journalErrors.${name} 미사용`).toBe(true);
    }
  });

  it('구현이 던지는 코드는 모두 선언돼 있다', () => {
    const declared = new Set<string>();
    for (const id of JNL_OPS) {
      for (const code of (operations.get(id)?.['x-error-codes'] as string[] | undefined) ?? []) {
        declared.add(code);
      }
    }
    for (const code of defined) {
      expect(declared.has(code), `${code}가 계약에 선언되지 않았다`).toBe(true);
    }
  });

  it('계약이 선언한 코드는 모두 구현이 던진다 (ADR-33 D17)', () => {
    // Export는 CC-160 경로에 위임하므로 그쪽 코드도 실제로 나온다 — 일지
    // 소스만 훑으면 "선언했는데 안 던진다"는 거짓 실패가 된다.
    const exportErrors = readFileSync(
      join(repoPath('services', 'api', 'src', 'document'), 'export-errors.ts'),
      'utf8',
    );
    const shared = new Set([...exportErrors.matchAll(/'(EXPORT-\d{3}-\d{3})'/g)].map((m) => m[1]));
    const thrown = new Set([...defined, ...shared, 'COM-0400', 'JOURNAL-400-001']);
    for (const id of JNL_OPS) {
      for (const code of (operations.get(id)?.['x-error-codes'] as string[] | undefined) ?? []) {
        expect(thrown.has(code), `${id}이 선언한 ${code}를 구현이 던지지 않는다`).toBe(true);
      }
    }
  });
});

describe('CC-300 계약: RLS 커버리지 목록이 줄었다', () => {
  it('journal·journal_projection_item을 닫았다', () => {
    expect(MIGRATION).toContain('p_journal_tenant');
    expect(MIGRATION).toContain('p_journal_projection_item_tenant');
    const guard = readFileSync(
      repoPath('tests', 'integration', 'src', 'rls-coverage.test.ts'),
      'utf8',
    );
    const known = guard.slice(guard.indexOf('const KNOWN_OPEN'), guard.indexOf('describe.skipIf'));
    expect(known).not.toContain("'journal'");
    expect(known).not.toContain("'journal_projection_item'");
  });
});
