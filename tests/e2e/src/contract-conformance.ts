import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

/**
 * 실제 응답을 계약에 대고 검증한다 (CC-290 이중검토 보정).
 *
 * **이것이 없어서 두 번 새어 나갔다.**
 *   * CC-280: 서버가 `SopRun.status='COMPLETED'`를 내보내는데 계약 enum에 그
 *     값이 없었다.
 *   * CC-290: `ExecutionEventTimelineItem`이 allOf + `additionalProperties:false`
 *     조합이라 **어떤 응답으로도 만족될 수 없었다**(ADR-24 D4).
 *
 * `validate:contracts`는 media-type **example**만 검증하고, 계약 게이트는
 * 스키마를 문자열로 훑는다. 둘 다 "서버가 실제로 무엇을 내보내는가"를 보지
 * 않는다. 여기서 그것을 본다.
 */

const ROOT = join(__dirname, '..', '..', '..');

interface OpenApiDoc {
  components: { schemas: Record<string, unknown> };
}

let cached: { ajv: Ajv2020; doc: OpenApiDoc } | null = null;

function load(): { ajv: Ajv2020; doc: OpenApiDoc } {
  if (cached) return cached;
  const raw = readFileSync(join(ROOT, 'contracts', 'openapi', 'une-platform-api-v1.yaml'), 'utf8');
  const doc = parse(raw) as OpenApiDoc;

  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: true });
  addFormats(ajv);
  // 3.1 문서지만 일부 스키마가 3.0의 `nullable`을 쓴다. 2020-12는 그것을 모르는
  // 키워드로 무시하므로, 검증 전에 `type: [t, 'null']`로 정규화한다 — 그러지
  // 않으면 정상 응답의 null이 거짓 실패를 낸다.
  const normalized = normalizeNullable({ components: doc.components }) as Record<string, unknown>;
  ajv.addSchema({ $id: 'une-platform', ...normalized }, 'une-platform');
  cached = { ajv, doc };
  return cached;
}

function normalizeNullable(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalizeNullable);
  if (typeof node !== 'object' || node === null) return node;
  const source = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === 'nullable') continue;
    out[key] = normalizeNullable(value);
  }
  if (source.nullable === true) {
    if (typeof out.type === 'string') out.type = [out.type, 'null'];
    else if (out.$ref) return { anyOf: [{ $ref: out.$ref }, { type: 'null' }] };
    else if (!out.type && !out.anyOf && !out.oneOf && !out.allOf) return out;
  }
  return out;
}

const validators = new Map<string, ValidateFunction>();

function validatorFor(schemaName: string): ValidateFunction {
  const existing = validators.get(schemaName);
  if (existing) return existing;
  const { ajv } = load();
  const fn = ajv.compile({ $ref: `une-platform#/components/schemas/${schemaName}` });
  validators.set(schemaName, fn);
  return fn;
}

/**
 * 응답 본문이 그 스키마를 만족하는가.
 *
 * 실패하면 **무엇이 어긋났는지** 그대로 던진다 — "계약 위반"만 말하면 고치는
 * 사람이 스키마를 다시 읽어야 한다.
 */
export function assertMatchesSchema(schemaName: string, value: unknown): void {
  const validate = validatorFor(schemaName);
  if (validate(value)) return;
  const detail = (validate.errors ?? [])
    .map((e) => `${e.instancePath || '/'} ${e.message ?? ''} ${JSON.stringify(e.params)}`)
    .join('\n  ');
  throw new Error(`계약 위반 (${schemaName}):\n  ${detail}`);
}

/** 봉투를 벗기고 검증한다. */
export async function expectContract<T>(
  res: Response,
  schemaName: string,
  status = 200,
): Promise<T> {
  const text = await res.text();
  if (res.status !== status) {
    throw new Error(`기대 ${status}, 실제 ${res.status}: ${text.slice(0, 400)}`);
  }
  const body = JSON.parse(text) as { data: T };
  assertMatchesSchema(schemaName, body.data);
  return body.data;
}
