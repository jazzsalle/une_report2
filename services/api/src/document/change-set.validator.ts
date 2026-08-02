import {
  CHANGE_OPERATION_TYPES,
  CHANGE_SET_ORIGINS,
  SELECTION_KINDS,
  type ChangeOperation,
  type ChangeSetOrigin,
  type SelectionEnvelope,
} from '@une/domain';
import type { ErrorViolation } from '../common/api-error';

/**
 * 요청 **구조** 검증 (400 경계).
 *
 * 여기서 보는 것은 "이 JSON이 ChangeSet 요청의 모양인가"뿐이다. "이 편집을 이
 * 문서에 적용할 수 있는가"(노드 존재, 잠금, 정적영역, 표 경계)는 엔진의
 * 판단이며 422 DOC-422-004로 나간다. 두 층을 섞으면 클라이언트가 "요청을 고쳐라"
 * 와 "문서를 다시 읽어라"를 구별할 수 없다.
 *
 * 이 파일은 `contracts/schemas/change-set.schema.json`의 런타임 대응물이다.
 * 어휘(8종 연산, 7종 출처, 5종 선택)는 `@une/domain`에서 **가져온다** — 사본을
 * 만들면 어휘가 세 벌로 갈라진다.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MUTATION_ID_RE = /^[A-Za-z0-9._:-]{1,100}$/;
const MAX_OPERATIONS = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateTextPosition(value: unknown, path: string, violations: ErrorViolation[]): void {
  if (!isRecord(value)) {
    violations.push({ field: path, reason: '객체가 필요합니다.' });
    return;
  }
  if (typeof value.paragraphId !== 'string' || value.paragraphId.length === 0) {
    violations.push({ field: `${path}.paragraphId`, reason: '문자열이어야 합니다.' });
  }
  if (typeof value.offset !== 'number' || !Number.isInteger(value.offset) || value.offset < 0) {
    // 오프셋은 UTF-16 코드 단위 인덱스다(설계 07 §1.8). 음수·소수는 위치가 아니다.
    violations.push({
      field: `${path}.offset`,
      reason: '0 이상의 정수(UTF-16 오프셋)여야 합니다.',
    });
  }
}

export function validateSelectionEnvelope(
  value: unknown,
  path: string,
  violations: ErrorViolation[],
): void {
  if (!isRecord(value)) {
    violations.push({ field: path, reason: '객체가 필요합니다.' });
    return;
  }
  if (
    typeof value.kind !== 'string' ||
    !(SELECTION_KINDS as readonly string[]).includes(value.kind)
  ) {
    violations.push({ field: `${path}.kind`, reason: `허용 값: ${SELECTION_KINDS.join(', ')}` });
    return;
  }
  if (typeof value.baseRevisionId !== 'string' || !UUID_RE.test(value.baseRevisionId)) {
    violations.push({ field: `${path}.baseRevisionId`, reason: 'UUID 형식이어야 합니다.' });
  }
  // 화면좌표(x/y/rect/pixel)는 계약에 존재하지 않는다(§1.8-4). 타입이 아니라
  // **금지**이므로 이름이 들어온 것만으로 거부한다.
  for (const forbidden of ['x', 'y', 'rect', 'pixel', 'clientX', 'clientY', 'rawXmlAnchor']) {
    if (forbidden in value) {
      violations.push({
        field: `${path}.${forbidden}`,
        reason: '선택영역에 화면좌표/원시 XML 앵커를 실을 수 없습니다.',
      });
    }
  }
  switch (value.kind) {
    case 'CURSOR':
      validateTextPosition(value.at, `${path}.at`, violations);
      break;
    case 'TEXT_RANGE':
      validateTextPosition(value.start, `${path}.start`, violations);
      validateTextPosition(value.end, `${path}.end`, violations);
      break;
    case 'BLOCK':
      if (
        !Array.isArray(value.blockIds) ||
        value.blockIds.length === 0 ||
        value.blockIds.some((id) => typeof id !== 'string' || id.length === 0)
      ) {
        violations.push({
          field: `${path}.blockIds`,
          reason: '1개 이상의 문자열 배열이어야 합니다.',
        });
      }
      break;
    case 'SECTION':
      if (typeof value.sectionId !== 'string' || value.sectionId.length === 0) {
        violations.push({ field: `${path}.sectionId`, reason: '문자열이어야 합니다.' });
      }
      break;
    default:
      if (typeof value.tableId !== 'string' || value.tableId.length === 0) {
        violations.push({ field: `${path}.tableId`, reason: '문자열이어야 합니다.' });
      }
      if (typeof value.cellId !== 'string' || value.cellId.length === 0) {
        violations.push({ field: `${path}.cellId`, reason: '문자열이어야 합니다.' });
      }
      if (value.start !== undefined) validateTextPosition(value.start, `${path}.start`, violations);
      if (value.end !== undefined) validateTextPosition(value.end, `${path}.end`, violations);
  }
}

function validateSource(value: unknown, path: string, violations: ErrorViolation[]): void {
  if (!isRecord(value)) {
    violations.push({ field: path, reason: '객체가 필요합니다.' });
    return;
  }
  switch (value.kind) {
    case 'INLINE':
      if (!Array.isArray(value.blocks) || value.blocks.length === 0) {
        violations.push({ field: `${path}.blocks`, reason: '1개 이상의 배열이어야 합니다.' });
      }
      break;
    case 'PROTOTYPE':
      if (typeof value.prototypeId !== 'string' || value.prototypeId.length === 0) {
        violations.push({ field: `${path}.prototypeId`, reason: '문자열이어야 합니다.' });
      }
      if (typeof value.count !== 'number' || !Number.isInteger(value.count) || value.count < 1) {
        violations.push({ field: `${path}.count`, reason: '1 이상의 정수여야 합니다.' });
      }
      break;
    case 'GENERATED_BLOCKS':
      if (typeof value.planId !== 'string' || !UUID_RE.test(value.planId)) {
        violations.push({ field: `${path}.planId`, reason: 'UUID 형식이어야 합니다.' });
      }
      if (typeof value.tocVersionId !== 'string' || !UUID_RE.test(value.tocVersionId)) {
        violations.push({ field: `${path}.tocVersionId`, reason: 'UUID 형식이어야 합니다.' });
      }
      break;
    default:
      violations.push({
        field: `${path}.kind`,
        reason: '허용 값: INLINE, PROTOTYPE, GENERATED_BLOCKS',
      });
  }
}

export function validateOperations(
  value: unknown,
  violations: ErrorViolation[],
): ChangeOperation[] {
  if (!Array.isArray(value) || value.length === 0) {
    violations.push({ field: 'operations', reason: '1개 이상의 배열이어야 합니다.' });
    return [];
  }
  if (value.length > MAX_OPERATIONS) {
    violations.push({ field: 'operations', reason: `연산은 ${MAX_OPERATIONS}개 이하여야 합니다.` });
    return [];
  }
  const orders = new Set<number>();
  value.forEach((raw, index) => {
    const path = `operations[${index}]`;
    if (!isRecord(raw)) {
      violations.push({ field: path, reason: '객체가 필요합니다.' });
      return;
    }
    if (
      typeof raw.type !== 'string' ||
      !(CHANGE_OPERATION_TYPES as readonly string[]).includes(raw.type)
    ) {
      violations.push({
        field: `${path}.type`,
        reason: `허용 값: ${CHANGE_OPERATION_TYPES.join(', ')}`,
      });
    }
    if (typeof raw.order !== 'number' || !Number.isInteger(raw.order) || raw.order < 0) {
      violations.push({ field: `${path}.order`, reason: '0 이상의 정수여야 합니다.' });
    } else if (orders.has(raw.order)) {
      // uk_change_operation_order(0019 §4.3)를 요청 단계에서 미리 막는다.
      // 순서가 곧 의미인 자리에서는 유일성이 성능이 아니라 정확성이다.
      violations.push({ field: `${path}.order`, reason: 'order가 중복됩니다.' });
    } else {
      orders.add(raw.order);
    }
    if (raw.selection !== undefined) {
      validateSelectionEnvelope(raw.selection, `${path}.selection`, violations);
    }
    if (raw.anchor !== undefined) {
      if (!isRecord(raw.anchor)) {
        violations.push({ field: `${path}.anchor`, reason: '객체가 필요합니다.' });
      } else {
        if (
          !['BEFORE', 'AFTER', 'FIRST_CHILD', 'LAST_CHILD'].includes(String(raw.anchor.relation))
        ) {
          violations.push({
            field: `${path}.anchor.relation`,
            reason: '허용 값: BEFORE, AFTER, FIRST_CHILD, LAST_CHILD',
          });
        }
        if (typeof raw.anchor.ref !== 'string' || raw.anchor.ref.length === 0) {
          violations.push({ field: `${path}.anchor.ref`, reason: '문자열이어야 합니다.' });
        }
      }
    }
    if (raw.source !== undefined) validateSource(raw.source, `${path}.source`, violations);
    if (raw.payload !== undefined && !isRecord(raw.payload)) {
      violations.push({ field: `${path}.payload`, reason: '객체가 필요합니다.' });
    }
  });
  return violations.length === 0 ? (value as ChangeOperation[]) : [];
}

export function validateMutationId(
  value: unknown,
  field: string,
  violations: ErrorViolation[],
): string {
  if (typeof value !== 'string' || !MUTATION_ID_RE.test(value)) {
    violations.push({ field, reason: '허용 문자 [A-Za-z0-9._:-], 1~100자여야 합니다.' });
    return '';
  }
  return value;
}

export function validateUuid(value: unknown, field: string, violations: ErrorViolation[]): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    violations.push({ field, reason: 'UUID 형식이어야 합니다.' });
    return '';
  }
  return value;
}

export function validateOrigin(value: unknown, violations: ErrorViolation[]): ChangeSetOrigin {
  if (typeof value !== 'string' || !(CHANGE_SET_ORIGINS as readonly string[]).includes(value)) {
    violations.push({ field: 'origin', reason: `허용 값: ${CHANGE_SET_ORIGINS.join(', ')}` });
    return 'USER';
  }
  return value as ChangeSetOrigin;
}

export type { SelectionEnvelope };
