/**
 * 워커 공개 표면 (CC-170).
 *
 * CC-160까지 이 서비스에는 진입점이 없어(`main.ts`만 있었다) 워크스페이스 밖에서
 * 러너를 쓸 수 없었다. 슬라이스 E2E는 API와 워커를 **같은 프로세스에서** 돌려
 * "요청이 접수되고 워커가 처리해 사용자가 받는다"를 한 흐름으로 증명해야 하므로
 * 러너를 공개한다.
 *
 * 공개하는 것은 러너와 그 부속(설정·DB 핸들)뿐이다. 저장소(repository) 함수들은
 * 러너의 내부 구현이며, 밖에서 부르면 트랜잭션 경계가 러너 밖으로 새어 나간다.
 */
export { ExportJobRunner, type ExportRunSummary } from './document-export/export-job.runner';
export { TocJobRunner } from './plan-toc/toc-job.runner';
export { ContentJobRunner } from './plan-content/content-job.runner';
export { SopJobRunner, type SopRunSummary } from './sop/sop-job.runner';
export { OutboxRelayRunner, type OutboxRelaySummary } from './dispatch/outbox-relay.runner';
export { PlanJobPoller } from './plan-jobs/job.poller';
export { WorkerDatabase } from './db/worker-database.service';
export { loadWorkerConfig, type WorkerConfig } from './config/worker-config';
