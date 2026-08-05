import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadYaml, repoPath } from './contract-loader';

/**
 * CC-170 UNE-DOC-001~004 계약 표면 + `x-db-tables` 실재성 게이트.
 *
 * 두 번째 검사가 이 파일의 존재 이유다. CC-170 착수 시점에 UNE-DOC-002의
 * `x-db-tables`는 `malware_scan`을 가리켰지만 **그 테이블은 어떤 마이그레이션에도
 * 없었다**. 계약이 존재하지 않는 테이블을 가리키면 `x-db-tables`는 검증 가능한
 * 사실이 아니라 장식이 되고, 다음 사람은 그것을 근거로 설계를 읽는다.
 *
 * 구현된 API만 검사한다. 구현 여부는 컨트롤러 주석의 API ID에서 **유도**한다 —
 * 손으로 관리하는 목록은 반드시 낡는다. 아직 구현되지 않은 API(CC-200~310의
 * 심의·승인·저널·전파 계열)는 자기 항목에서 테이블과 함께 생기므로 지금 막으면
 * 설계 기준선의 전방 참조를 지우게 된다.
 */

const CONTRACT = ['contracts', 'openapi', 'une-platform-api-v1.yaml'];
const DICTIONARY = repoPath('docs', 'db', 'DATA_DICTIONARY.md');
const CONTROLLER_ROOT = repoPath('services', 'api', 'src');

interface Operation extends Record<string, unknown> {
  __path: string;
  __method: string;
}

const doc = loadYaml(...CONTRACT) as {
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components: { schemas: Record<string, Record<string, unknown>> };
};

const operations = new Map<string, Operation>();
for (const [path, methods] of Object.entries(doc.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    if (typeof operation !== 'object' || operation === null) continue;
    const id = operation['x-une-api-id'];
    if (typeof id === 'string')
      operations.set(id, { ...operation, __path: path, __method: method });
  }
}

function realTables(): Set<string> {
  const md = readFileSync(DICTIONARY, 'utf8');
  const names = [...md.matchAll(/^## (\S+)$/gm)].map((m) => m[1]);
  // 사전이 비면 "모든 테이블이 없다"가 아니라 게이트가 고장난 것이다.
  if (names.length < 50) throw new Error(`데이터 사전을 읽지 못했다 (테이블 ${names.length}개)`);
  return new Set(names);
}

function implementedApiIds(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.controller.ts')) {
        for (const m of readFileSync(full, 'utf8').matchAll(/UNE-[A-Z]+-\d{3}/g)) found.add(m[0]);
      }
    }
  };
  walk(CONTROLLER_ROOT);
  if (found.size === 0)
    throw new Error('컨트롤러에서 API ID를 하나도 찾지 못했다 (주석 규약 변경?)');
  return found;
}

describe('UNE-DOC-001~004 계약 표면', () => {
  it('설계 10 §3.4의 경로·메서드·권한을 그대로 쓴다', () => {
    const expected: Record<string, [string, string, string]> = {
      'UNE-DOC-001': ['post', '/files', 'FILE_UPLOAD'],
      'UNE-DOC-002': ['post', '/files/{fileId}/complete', 'FILE_UPLOAD'],
      'UNE-DOC-003': ['post', '/documents/import-hwpx', 'PLAN_CREATE'],
      'UNE-DOC-004': ['get', '/documents/{documentId}/analysis', 'DOC_READ'],
    };
    for (const [id, [method, path, permission]] of Object.entries(expected)) {
      const operation = operations.get(id);
      expect(operation, `${id} 누락`).toBeDefined();
      expect(operation?.__method).toBe(method);
      expect(operation?.__path).toBe(path);
      expect(operation?.['x-permission']).toBe(permission);
    }
  });

  it('생성 3종은 Idempotency-Key를 선언하고 자리표시자 스키마를 쓰지 않는다', () => {
    for (const id of ['UNE-DOC-001', 'UNE-DOC-002', 'UNE-DOC-003']) {
      const operation = operations.get(id) as unknown as {
        parameters: { $ref?: string }[];
        requestBody?: { content: Record<string, { schema: { $ref?: string } }> };
        responses: Record<string, { content?: Record<string, { schema: { $ref?: string } }> }>;
      };
      expect(
        operation.parameters.some((p) => p.$ref === '#/components/parameters/IdempotencyKey'),
        `${id}: Idempotency-Key 선언 누락`,
      ).toBe(true);
      const request = operation.requestBody?.content['application/json']?.schema.$ref;
      expect(request, `${id}: 요청 스키마 누락`).toBeDefined();
      expect(request, `${id}: GenericRequest 자리표시자가 남아 있다`).not.toContain('Generic');
    }
    for (const id of ['UNE-DOC-001', 'UNE-DOC-002', 'UNE-DOC-003', 'UNE-DOC-004']) {
      const responses = (
        operations.get(id) as unknown as {
          responses: Record<string, { content?: Record<string, { schema: { $ref?: string } }> }>;
        }
      ).responses;
      const success = Object.entries(responses).find(([code]) => code.startsWith('2'));
      const schema = success?.[1].content?.['application/json']?.schema.$ref;
      expect(schema, `${id}: 성공 응답 스키마 누락`).toBeDefined();
      expect(schema, `${id}: GenericResponse 자리표시자가 남아 있다`).not.toContain('Generic');
    }
  });

  it('업로드 상태와 스캔 상태는 별개 어휘다 (검증했다고 검사한 것이 되지 않는다)', () => {
    const schemas = doc.components.schemas;
    expect((schemas.FileUploadState as { enum: string[] }).enum).toEqual([
      'PENDING',
      'VERIFIED',
      'ABORTED',
    ]);
    expect((schemas.FileScanStatus as { enum: string[] }).enum).toEqual([
      'PENDING',
      'CLEAN',
      'INFECTED',
    ]);
    const file = schemas.FileObjectResource as { required: string[]; properties: object };
    expect(file.required).toContain('uploadState');
    expect(file.required).toContain('scanStatus');
    // 저장소 키는 어느 응답에도 나가지 않는다 (테넌트 경로 = 내부 구조).
    expect(Object.keys(file.properties)).not.toContain('storageKey');
  });

  it('업로드 티켓은 만료·상한·전송 방법을 함께 준다', () => {
    const ticket = doc.components.schemas.FileUploadTicket as {
      required: string[];
      properties: { driver: { enum: string[] } };
    };
    for (const key of ['url', 'method', 'headers', 'expiresAt', 'maxSizeBytes', 'driver']) {
      expect(ticket.required, `티켓 필수 필드 ${key} 누락`).toContain(key);
    }
    expect(ticket.properties.driver.enum).toEqual(['PRESIGNED_S3', 'API_DIRECT']);
  });

  it('반입은 VERIFIED 파일만 받고 planId를 계약에 남긴다', () => {
    const request = doc.components.schemas.HwpImportRequest as {
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, { description?: string }>;
    };
    expect(request.required).toEqual(['fileId']);
    expect(request.additionalProperties).toBe(false);
    expect(request.properties.fileId.description).toContain('VERIFIED');
    expect(request.properties.planId).toBeDefined();
  });
});

describe('계약의 x-db-tables는 실제 테이블만 가리킨다', () => {
  it('구현된 API가 선언한 테이블은 모두 데이터 사전에 있다', () => {
    const tables = realTables();
    const implemented = implementedApiIds();
    const phantom: string[] = [];
    let checked = 0;
    for (const [id, operation] of operations) {
      if (!implemented.has(id)) continue;
      checked += 1;
      for (const table of (operation['x-db-tables'] as string[] | undefined) ?? []) {
        if (!tables.has(table)) phantom.push(`${id} -> ${table}`);
      }
    }
    // 검사 대상이 0이면 통과가 아니라 유도가 깨진 것이다.
    expect(checked).toBeGreaterThanOrEqual(31);
    expect(phantom).toEqual([]);
  });

  it('구현된 API 목록은 컨트롤러에서 유도되며 계약에 모두 존재한다', () => {
    const implemented = implementedApiIds();
    const missing = [...implemented].filter((id) => !operations.has(id));
    expect(missing, '컨트롤러가 계약에 없는 API ID를 주장한다').toEqual([]);
  });
});
