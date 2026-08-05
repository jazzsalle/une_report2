import type { ApiFailure } from '../api/errors';
import type {
  DocumentAnalysis,
  ExportJob,
  GenerationJob,
  ImportedDocument,
  PlanResource,
  UserContext,
} from '../api/slice';

/**
 * Plan 수직 슬라이스의 화면 상태 (CC-170).
 *
 * 여섯 단계를 **선형**으로 둔다. 실제 업무는 오가지만, 이 화면이 증명하려는 것은
 * "SSO부터 HWPX 다운로드까지 한 번 이어진다"이고, 그 경로를 화면 증거로 남기는
 * 것이 목적이다. 편집기 화면은 없다 — rhwp가 반입되지 않았다(OB-12).
 *
 * 단계 이동을 사용자가 임의로 못 하게 막지 않는다. 대신 각 단계는 자기 선행
 * 조건을 상태에서 읽어 "무엇이 없어서 못 하는지"를 화면에 적는다. 막아 두면
 * 사용자는 왜 막혔는지 모른다.
 */

export const STEPS = [
  { key: 'login', title: '1. 로그인', api: 'UNE-AUTH-001/002' },
  { key: 'plan', title: '2. 계획서', api: 'UNE-PLAN-001/002' },
  { key: 'context', title: '3. 기준정보', api: 'UNE-PLAN-006/007' },
  { key: 'upload', title: '4. HWPX 반입', api: 'UNE-DOC-001~004' },
  { key: 'generate', title: '5. 목차·본문 생성', api: 'UNE-PLAN-009/010/016' },
  { key: 'export', title: '6. Export·다운로드', api: 'UNE-DOC-012~014' },
] as const;

export type StepKey = (typeof STEPS)[number]['key'];

export interface SliceState {
  step: StepKey;
  busy: boolean;
  failure: ApiFailure | null;
  /** 사용자가 화면에서 읽어 문의에 쓸 수 있어야 한다(설계 09 필수증거). */
  correlationId: string;
  log: LogEntry[];

  user: UserContext | null;
  plan: PlanResource | null;
  plans: PlanResource[];
  contextSnapshotId: string | null;

  fileId: string | null;
  fileState: string | null;
  uploadDriver: string | null;
  document: ImportedDocument | null;
  analysis: DocumentAnalysis | null;

  tocJob: GenerationJob | null;
  tocVersionId: string | null;
  contentJob: GenerationJob | null;

  /** materialize 결과 — 생성 본문이 실제로 문서에 들어갔는가. */
  materialized: { insertedBlocks: number; candidateBlocks: number; revisionNo: number } | null;
  exportJob: ExportJob | null;
  downloaded: { fileName: string; sizeBytes: number; sha256: string } | null;
}

export interface LogEntry {
  at: string;
  label: string;
  detail?: string;
  correlationId: string;
  ok: boolean;
}

export const initialState: SliceState = {
  step: 'login',
  busy: false,
  failure: null,
  correlationId: '',
  log: [],
  user: null,
  plan: null,
  plans: [],
  contextSnapshotId: null,
  fileId: null,
  fileState: null,
  uploadDriver: null,
  document: null,
  analysis: null,
  tocJob: null,
  tocVersionId: null,
  contentJob: null,
  materialized: null,
  exportJob: null,
  downloaded: null,
};

export type SliceAction =
  | { type: 'STEP'; step: StepKey }
  | { type: 'BUSY'; busy: boolean }
  | { type: 'FAIL'; failure: ApiFailure | null }
  | { type: 'TRACE'; correlationId: string }
  | { type: 'LOG'; entry: LogEntry }
  | { type: 'USER'; user: UserContext }
  | { type: 'PLAN'; plan: PlanResource }
  | { type: 'PLANS'; plans: PlanResource[] }
  | { type: 'SNAPSHOT'; contextSnapshotId: string }
  | { type: 'FILE'; fileId: string; fileState: string; uploadDriver?: string }
  | { type: 'DOCUMENT'; document: ImportedDocument }
  | { type: 'ANALYSIS'; analysis: DocumentAnalysis }
  | { type: 'TOC_JOB'; job: GenerationJob }
  | { type: 'TOC_VERSION'; tocVersionId: string }
  | { type: 'CONTENT_JOB'; job: GenerationJob }
  | { type: 'MATERIALIZED'; materialized: SliceState['materialized'] }
  | { type: 'EXPORT'; job: ExportJob }
  | { type: 'DOWNLOADED'; downloaded: SliceState['downloaded'] }
  | { type: 'RESET' };

export function reducer(state: SliceState, action: SliceAction): SliceState {
  switch (action.type) {
    case 'STEP':
      // 단계를 옮길 때 이전 오류를 지운다 — 다른 화면의 오류가 남아 있으면
      // 사용자는 방금 한 일이 실패한 것으로 읽는다.
      return { ...state, step: action.step, failure: null };
    case 'BUSY':
      return { ...state, busy: action.busy };
    case 'FAIL':
      return { ...state, failure: action.failure, busy: false };
    case 'TRACE':
      return { ...state, correlationId: action.correlationId };
    case 'LOG':
      // 최신이 위로. 100건을 넘기지 않는다(화면 증거용이지 저장소가 아니다).
      return { ...state, log: [action.entry, ...state.log].slice(0, 100) };
    case 'USER':
      return { ...state, user: action.user };
    case 'PLAN':
      return { ...state, plan: action.plan };
    case 'PLANS':
      return { ...state, plans: action.plans };
    case 'SNAPSHOT':
      return { ...state, contextSnapshotId: action.contextSnapshotId };
    case 'FILE':
      return {
        ...state,
        fileId: action.fileId,
        fileState: action.fileState,
        uploadDriver: action.uploadDriver ?? state.uploadDriver,
      };
    case 'DOCUMENT':
      return { ...state, document: action.document };
    case 'ANALYSIS':
      return { ...state, analysis: action.analysis };
    case 'TOC_JOB':
      return { ...state, tocJob: action.job };
    case 'TOC_VERSION':
      return { ...state, tocVersionId: action.tocVersionId };
    case 'CONTENT_JOB':
      return { ...state, contentJob: action.job };
    case 'MATERIALIZED':
      return { ...state, materialized: action.materialized };
    case 'EXPORT':
      return { ...state, exportJob: action.job };
    case 'DOWNLOADED':
      return { ...state, downloaded: action.downloaded };
    case 'RESET':
      return { ...initialState, correlationId: state.correlationId };
    default:
      return state;
  }
}

/** 각 단계의 선행 조건. 없으면 그 이유를 화면에 적는다. */
export function blockedReason(state: SliceState, step: StepKey): string | null {
  switch (step) {
    case 'login':
      return null;
    case 'plan':
      return state.user ? null : '먼저 로그인하십시오.';
    case 'context':
      return state.plan ? null : '계획서를 먼저 만들거나 선택하십시오.';
    case 'upload':
      return state.plan ? null : '계획서를 먼저 만들거나 선택하십시오.';
    case 'generate':
      if (!state.plan) return '계획서를 먼저 만들거나 선택하십시오.';
      if (!state.contextSnapshotId) return '기준정보 Snapshot을 먼저 확정하십시오.';
      return null;
    case 'export':
      return state.document ? null : 'HWPX를 먼저 반입하십시오.';
    default:
      return null;
  }
}

/** 진행 중인 Job인가. 화면이 폴링을 계속할지 판단한다. */
export function isJobOpen(job: GenerationJob | null): boolean {
  if (!job) return false;
  return job.status === 'QUEUED' || job.status === 'RUNNING' || job.status === 'CANCEL_REQUESTED';
}
