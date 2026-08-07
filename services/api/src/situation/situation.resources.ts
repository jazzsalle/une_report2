import { deriveContextState, type NormalizedFact } from '@une/domain';
import type {
  ConflictResolutionRow,
  ConflictRow,
  DuplicateGroupRow,
  SnapshotRow as ResolutionSnapshotRow,
} from './resolution.repository';
import type { ProviderJobRow, SituationFactRow, SituationRow } from './situation.repository';

/** 계약 리소스로의 투영 (CC-200).
 *
 * 날짜는 ISO-8601 UTC 문자열로 낸다(.claude/rules/backend.md).
 */

export interface SituationResource {
  situationId: string;
  tenantId: string;
  mode: string;
  title: string;
  hazardType: string;
  status: string;
  occurredAt: string | null;
  locationText: string | null;
  currentSnapshotId: string | null;
  versionNo: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SituationDetailResource extends SituationResource {
  contextState: string;
  candidateFactCount: number;
  openConflictCount: number;
}

export interface FactNormalizationResource {
  version: string;
  outcome: string;
  originalValue?: unknown;
  originalUnit?: string | null;
  notes?: { reason: string; detail: string }[];
}

export interface SituationFactResource {
  factId: string;
  situationId: string;
  factType: string;
  factKey: string;
  value: unknown;
  unit: string | null;
  source: {
    sourceId: string;
    providerCode: string;
    sourceType: string;
    sourceName: string;
    sourceUrl: string | null;
    collectedAt: string;
  };
  observedAt: string | null;
  collectedAt: string;
  confidence: number | null;
  status: string;
  normalization?: FactNormalizationResource;
  /** 파생 계보(0025 §2). 원천이면 null이다. 화면이 "무엇에서 보정됐는가"를
   * 그릴 수 있어야 한다(설계 06 US-SIT-007 #3, 아키텍처 리뷰 m-6). */
  originalFactId: string | null;
  derivedReason: string | null;
  versionNo: number;
  updatedAt: string;
}

export interface ProviderJobResource {
  providerJobId: string;
  batchId: string;
  situationId: string | null;
  providerCode: string;
  status: string;
  resultCount: number;
  error: Record<string, unknown> | null;
  correlationId: string;
  createdAt: string;
  finishedAt: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

function iso(value: Date): string {
  return value.toISOString();
}

/**
 * `situation_fact.value_json`에 저장하는 형태.
 *
 * 계약의 `SituationFact`는 `value`/`unit`을 최상위에 두지만 DB에는 jsonb 한
 * 칸뿐이므로 여기서 감싼다. **`raw`(Provider 원문 조각)는 저장하되 응답에
 * 싣지 않는다** — 추적성은 지키고 화면·로그로 나가는 개인정보는 늘리지
 * 않는다(.claude/rules/security.md의 최소화). 원문값 확인은
 * `normalization.originalValue`로 충분하다(A-01이 요구하는 것이 그것이다).
 */
export interface FactValueEnvelope {
  value: unknown;
  unit: string | null;
  normalization: {
    version: string;
    outcome: string;
    originalValue: unknown;
    originalUnit: string | null;
    notes: { reason: string; detail: string }[];
  };
  raw?: unknown;
}

export function toFactValueEnvelope(fact: NormalizedFact): FactValueEnvelope {
  return {
    value: fact.value,
    unit: fact.unit,
    normalization: {
      version: fact.normalizationVersion,
      outcome: fact.outcome,
      originalValue: fact.originalValue,
      originalUnit: fact.originalUnit,
      notes: fact.notes.map((n) => ({ reason: n.reason, detail: n.detail })),
    },
    raw: fact.raw,
  };
}

function readEnvelope(valueJson: unknown): {
  value: unknown;
  unit: string | null;
  normalization?: FactNormalizationResource;
} {
  if (typeof valueJson !== 'object' || valueJson === null) {
    // 0004부터 있던 열린 jsonb 컬럼이다. CC-200 밖에서 들어온 형태를 만나도
    // 응답을 못 만드는 일이 없도록 값 자체로 취급한다.
    return { value: valueJson, unit: null };
  }
  const envelope = valueJson as Record<string, unknown>;
  if (!('value' in envelope)) return { value: valueJson, unit: null };
  const normalization = envelope.normalization as Record<string, unknown> | undefined;
  return {
    value: envelope.value,
    unit: (envelope.unit as string | null) ?? null,
    ...(normalization
      ? {
          normalization: {
            version: String(normalization.version ?? ''),
            outcome: String(normalization.outcome ?? ''),
            originalValue: normalization.originalValue,
            originalUnit: (normalization.originalUnit as string | null) ?? null,
            notes: (normalization.notes as { reason: string; detail: string }[] | undefined) ?? [],
          },
        }
      : {}),
  };
}

export function toSituationResource(row: SituationRow): SituationResource {
  return {
    situationId: row.situationId,
    tenantId: row.tenantId,
    mode: row.mode,
    title: row.title,
    hazardType: row.hazardType,
    status: row.status,
    occurredAt: row.occurredAt ? iso(row.occurredAt) : null,
    locationText: row.locationText,
    currentSnapshotId: row.currentSnapshotId,
    versionNo: row.versionNo,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toSituationDetailResource(
  row: SituationRow,
  counts: { candidateFactCount: number; openConflictCount: number },
): SituationDetailResource {
  return {
    ...toSituationResource(row),
    // 저장값이 아니라 파생값이다(0023 §8). 두 벌을 두지 않는다.
    contextState: deriveContextState({
      candidateFactCount: counts.candidateFactCount,
      openConflictCount: counts.openConflictCount,
      currentSnapshotId: row.currentSnapshotId,
    }),
    candidateFactCount: counts.candidateFactCount,
    openConflictCount: counts.openConflictCount,
  };
}

export function toFactResource(row: SituationFactRow): SituationFactResource {
  const envelope = readEnvelope(row.valueJson);
  return {
    factId: row.factId,
    situationId: row.situationId,
    factType: row.factType,
    factKey: row.factKey,
    value: envelope.value,
    unit: envelope.unit,
    source: {
      sourceId: row.source.sourceId,
      providerCode: row.source.providerCode,
      sourceType: row.source.sourceType,
      sourceName: row.source.sourceName,
      sourceUrl: row.source.sourceUri,
      collectedAt: iso(row.source.retrievedAt),
    },
    observedAt: row.observedAt ? iso(row.observedAt) : null,
    collectedAt: iso(row.collectedAt),
    // numeric은 pg가 문자열로 준다. 계약은 number이므로 여기서 옮긴다.
    confidence: row.confidence === null ? null : Number(row.confidence),
    status: row.status,
    ...(envelope.normalization ? { normalization: envelope.normalization } : {}),
    originalFactId: row.originalFactId,
    derivedReason: row.derivedReason,
    versionNo: row.versionNo,
    updatedAt: iso(row.updatedAt),
  };
}

export function toProviderJobResource(row: ProviderJobRow): ProviderJobResource {
  return {
    providerJobId: row.providerJobId,
    batchId: row.batchId,
    situationId: row.situationId,
    providerCode: row.providerCode,
    status: row.status,
    resultCount: row.resultCount,
    error: (row.errorJson as Record<string, unknown> | null) ?? null,
    correlationId: row.correlationId,
    createdAt: iso(row.createdAt),
    finishedAt: iso(row.finishedAt),
  };
}

// ── CC-210: 중복군·충돌·해소·Snapshot ──────────────────────────────────────

export interface DuplicateGroupResource {
  groupId: string;
  situationId: string;
  factKey: string;
  groupKey: string;
  strategy: string;
  threshold: number | null;
  memberFactIds: string[];
  memberCount: number;
  computedAt: string;
}

export interface ConflictResource {
  conflictId: string;
  situationId: string;
  groupKey: string | null;
  factKey: string;
  conflictType: string;
  status: string;
  candidateFactIds: string[];
  detectedAt: string;
}

export interface ConflictResolutionResource {
  resolutionId: string;
  conflictId: string;
  factKey: string;
  selectedFactId: string;
  reason: string;
  resolvedBy: string;
  resolvedAt: string;
}

export interface DeduplicateResult {
  groups: DuplicateGroupResource[];
  conflicts: ConflictResource[];
  conflictsOpened: number;
  /** 이번 계산으로 "더 이상 존재하지 않는" 것이 된 충돌 수(0025 §4 OBSOLETE). */
  conflictsObsoleted: number;
}

export interface SnapshotResource {
  snapshotId: string;
  situationId: string;
  versionNo: number;
  effectiveAt: string;
  facts: unknown[];
  contentHash: string;
  supersedesSnapshotId: string | null;
  confirmedBy: string;
  confirmedAt: string;
}

export function toDuplicateGroupResource(row: DuplicateGroupRow): DuplicateGroupResource {
  return {
    groupId: row.groupId,
    situationId: row.situationId,
    factKey: row.factKey,
    groupKey: row.groupKey,
    strategy: row.strategy,
    // numeric은 pg가 문자열로 준다.
    threshold: row.threshold === null ? null : Number(row.threshold),
    memberFactIds: row.memberFactIds,
    memberCount: row.memberCount,
    computedAt: iso(row.computedAt),
  };
}

export function toConflictResource(row: ConflictRow): ConflictResource {
  return {
    conflictId: row.conflictId,
    situationId: row.situationId,
    groupKey: row.groupKey,
    factKey: row.factKey,
    conflictType: row.conflictType,
    status: row.status,
    candidateFactIds: row.candidateFactIds,
    detectedAt: iso(row.detectedAt),
  };
}

export function toResolutionResource(
  row: ConflictResolutionRow,
  factKey: string,
): ConflictResolutionResource {
  return {
    resolutionId: row.resolutionId,
    conflictId: row.conflictId,
    factKey,
    selectedFactId: row.selectedFactId,
    reason: row.reason,
    resolvedBy: row.resolvedBy,
    resolvedAt: iso(row.resolvedAt),
  };
}

export function toSnapshotResource(row: ResolutionSnapshotRow): SnapshotResource {
  return {
    snapshotId: row.snapshotId,
    situationId: row.situationId,
    versionNo: row.versionNo,
    effectiveAt: iso(row.effectiveAt),
    facts: Array.isArray(row.factsJson) ? (row.factsJson as unknown[]) : [],
    contentHash: row.contentHash,
    supersedesSnapshotId: row.supersedesId,
    confirmedBy: row.confirmedBy,
    confirmedAt: iso(row.confirmedAt),
  };
}

/** Snapshot에 박히는 Fact 사본. 도메인 `SnapshotFact`와 같은 모양이며
 * 확정 시점의 값을 그대로 얼린다(설계 06 A-02: 확정 후 자동변경 금지). */
export function toSnapshotFact(fact: SituationFactResource): {
  factId: string;
  factType: string;
  factKey: string;
  value: unknown;
  unit: string | null;
  source: {
    providerCode: string;
    sourceName: string;
    sourceUrl: string | null;
    collectedAt: string;
  };
  observedAt: string | null;
  collectedAt: string;
  confidence: number | null;
  status: string;
} {
  return {
    factId: fact.factId,
    factType: fact.factType,
    factKey: fact.factKey,
    value: fact.value,
    unit: fact.unit,
    source: {
      providerCode: fact.source.providerCode,
      sourceName: fact.source.sourceName,
      sourceUrl: fact.source.sourceUrl,
      collectedAt: fact.source.collectedAt,
    },
    observedAt: fact.observedAt,
    collectedAt: fact.collectedAt,
    confidence: fact.confidence,
    // 확정 시점의 상태를 박는다. 이 사본은 이후 어떤 UPDATE에도 따라가지 않는다.
    status: 'CONFIRMED',
  };
}

export function toPage<T>(items: T[], page: number, size: number, totalElements: number): Page<T> {
  return {
    items,
    page,
    size,
    totalElements,
    totalPages: size > 0 ? Math.ceil(totalElements / size) : 0,
  };
}
