import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';
import { AuthController } from './auth/auth.controller';
import { AuthRepository } from './auth/auth.repository';
import { AuthService } from './auth/auth.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { PermissionsGuard } from './auth/permissions.guard';
import { ApiErrorFilter } from './common/api-error.filter';
import { AuditRepository } from './common/audit.repository';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { IdempotencyRepository } from './common/idempotency.repository';
import { loggerProvider, metricsProvider } from './common/observability/logger.provider';
import { RequestLogInterceptor } from './common/observability/request-log.interceptor';
import { API_CONFIG, loadApiConfig, type ApiConfig } from './config/api-config';
import { DatabaseService } from './db/database.service';
import { ChangeSetService } from './document/change-set.service';
import { DocumentController } from './document/document.controller';
import { DocumentExportController, ExportController } from './document/export.controller';
import { DocumentImportController } from './document/document-import.controller';
import { DocumentImportService } from './document/document-import.service';
import { FileController } from './document/file.controller';
import { FileRepository } from './document/file.repository';
import { FileService } from './document/file.service';
import { DocumentRepository } from './document/document.repository';
import { DocumentService } from './document/document.service';
import { ExportRepository } from './document/export.repository';
import { ExportService } from './document/export.service';
import { objectStorageProvider } from './common/storage.provider';
import { HealthController, MetricsController } from './health/health.controller';
import { OrganizationsController, RolesController, UsersController } from './iam/iam.controller';
import { IamRepository } from './iam/iam.repository';
import { IamService } from './iam/iam.service';
import { ContentJobController } from './plan/content-job.controller';
import { ContentJobService } from './plan/content-job.service';
import { GeneratedBlockRepository } from './plan/generated-block.repository';
import { GenerationJobRepository } from './plan/generation-job.repository';
import { JobEventRepository } from './plan/job-event.repository';
import { JobSseService } from './plan/job-sse.service';
import { PlanJobController } from './plan/plan-job.controller';
import { PlanController } from './plan/plan.controller';
import { PlanRepository } from './plan/plan.repository';
import { PlanService } from './plan/plan.service';
import { TocJobController } from './plan/toc-job.controller';
import { TocJobService } from './plan/toc-job.service';
import { TocVersionController } from './plan/toc-version.controller';
import { TocVersionRepository } from './plan/toc-version.repository';
import { TocVersionService } from './plan/toc-version.service';
import { FactService } from './situation/fact.service';
import { ProviderQueryService } from './situation/provider-query.service';
import { ResolutionRepository } from './situation/resolution.repository';
import { ResolutionService } from './situation/resolution.service';
import { SnapshotService } from './situation/snapshot.service';
import { situationProviderFactory } from './situation/situation-provider.provider';
import { EvidenceController } from './knowledge/evidence.controller';
import { EvidenceRepository } from './knowledge/evidence.repository';
import { EvidenceService } from './knowledge/evidence.service';
import { uniKnowledgeFactory } from './knowledge/uni-knowledge.provider';
import { KnowledgeController } from './knowledge/knowledge.controller';
import { KnowledgeRepository } from './knowledge/knowledge.repository';
import { KnowledgeService } from './knowledge/knowledge.service';
import { DispatchController, TaskDispatchController } from './dispatch/dispatch.controller';
import { DispatchRepository } from './dispatch/dispatch.repository';
import { DispatchService } from './dispatch/dispatch.service';
import { TaskController } from './task/task.controller';
import { TaskRepository } from './task/task.repository';
import { TaskService } from './task/task.service';
import {
  ExecutionEventController,
  SituationBoardController,
} from './execution/execution.controller';
import { ExecutionRepository } from './execution/execution.repository';
import { ExecutionService } from './execution/execution.service';
import { JournalController, SituationJournalController } from './journal/journal.controller';
import { EvaluationController, SituationCloseController } from './evaluation/evaluation.controller';
import { EvaluationRepository } from './evaluation/evaluation.repository';
import { EvaluationService } from './evaluation/evaluation.service';
import { JOURNAL_NARRATIVE_PROVIDER, createNarrativeProvider } from '@une/provider-adapters';
import { JournalRepository } from './journal/journal.repository';
import { JournalService } from './journal/journal.service';
import { SopController } from './sop/sop.controller';
import { SopRunController, SopRunStartController } from './sop/sop-run.controller';
import { SopRunRepository } from './sop/sop-run.repository';
import { SopRunService } from './sop/sop-run.service';
import { SopJobController } from './sop/sop-job.controller';
import { SopJobService } from './sop/sop-job.service';
import { SopRepository } from './sop/sop.repository';
import { SopService } from './sop/sop.service';
import { ProviderJobController, SituationController } from './situation/situation.controller';
import { SituationRepository } from './situation/situation.repository';
import { SituationService } from './situation/situation.service';

@Module({})
export class AppModule {
  /** Config is injected (not read from process.env at import time) so tests
   * can boot the app against a dedicated database and auth mode. */
  static register(config: ApiConfig = loadApiConfig()): DynamicModule {
    return {
      module: AppModule,
      // CC-430: 등록된 라우트를 런타임에 훑을 수 있어야 한다. 기동 시점 가드
      // (`assertRoutesGuarded`)와 보안 전수 시험이 둘 다 이것을 쓴다 — 소스를
      // 정규식으로 읽으면 적힌 것만 보이고 모듈 누락은 보이지 않는다.
      imports: [DiscoveryModule],
      controllers: [
        HealthController,
        MetricsController,
        AuthController,
        OrganizationsController,
        UsersController,
        RolesController,
        PlanController,
        TocJobController,
        ContentJobController,
        TocVersionController,
        PlanJobController,
        DocumentController,
        DocumentImportController,
        FileController,
        DocumentExportController,
        ExportController,
        SituationController,
        KnowledgeController,
        EvidenceController,
        ProviderJobController,
        SopJobController,
        SopController,
        SopRunStartController,
        SopRunController,
        TaskDispatchController,
        DispatchController,
        TaskController,
        SituationBoardController,
        ExecutionEventController,
        SituationJournalController,
        JournalController,
        SituationCloseController,
        EvaluationController,
      ],
      providers: [
        { provide: API_CONFIG, useValue: config },
        DatabaseService,
        AuditRepository,
        AuthRepository,
        AuthService,
        IamRepository,
        IamService,
        PlanRepository,
        PlanService,
        GenerationJobRepository,
        JobEventRepository,
        GeneratedBlockRepository,
        TocVersionRepository,
        TocJobService,
        ContentJobService,
        TocVersionService,
        JobSseService,
        DocumentRepository,
        DocumentService,
        ChangeSetService,
        // CC-170: 업로드 3단(UNE-DOC-001/002)과 반입·분석조회(UNE-DOC-003/004).
        // CC-160까지 DocumentImportService에는 HTTP 표면이 없었다(ADR-31 D1).
        FileRepository,
        FileService,
        DocumentImportService,
        // CC-160: Export 접수·조회·다운로드. 되쓰기와 Track A는 워커가 한다.
        ExportRepository,
        ExportService,
        // CC-200: 상황과 후보 SituationFact 수집(UNE-SIT-001~005/007/008/014/015).
        // Provider 호출은 동기이며 트랜잭션 밖에서 돈다(ADR-33 D2).
        SituationRepository,
        SituationService,
        KnowledgeRepository,
        KnowledgeService,
        EvidenceRepository,
        EvidenceService,
        uniKnowledgeFactory,
        FactService,
        ProviderQueryService,
        situationProviderFactory,
        // CC-210: 중복군·충돌 해소·불변 SituationSnapshot (UNE-SIT-009~013).
        ResolutionRepository,
        ResolutionService,
        SnapshotService,
        // CC-240: SOP 생성 접수와 SSE(UNE-SOP-001/002). UNI 호출은 워커가 한다.
        SopJobService,
        // CC-250: 캔버스 편집·검증·검토·승인(UNE-SOP-003~009). provider 호출이 없다.
        SopRepository,
        SopService,
        // CC-260: 실행 수명주기와 임무 생성·활성화(UNE-SOP-010~016).
        SopRunRepository,
        SopRunService,
        // CC-270: 전파 접수와 Transactional Outbox(UNE-TASK-003/013/014).
        // 실제 발송은 워커 릴레이가 한다 — 외부 호출이 트랜잭션 안에 없다.
        DispatchRepository,
        DispatchService,
        TaskRepository,
        TaskService,
        ExecutionRepository,
        ExecutionService,
        JournalRepository,
        JournalService,
        EvaluationRepository,
        EvaluationService,
        // 서술 제안 어댑터는 **모듈이 고른다**. 지금은 규칙 기반 시뮬레이션
        // 하나뿐이고(T3Q 계약에 일지 서술 연산이 없다, OB-03), 실 어댑터가
        // 오면 서비스가 아니라 이 줄이 바뀐다.
        { provide: JOURNAL_NARRATIVE_PROVIDER, useFactory: createNarrativeProvider },
        objectStorageProvider,
        IdempotencyRepository,
        // Registration order matters: authentication before permission checks;
        // the idempotency interceptor runs after both guards.
        loggerProvider,
        metricsProvider,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        // 요청 로그는 **가장 바깥**이어야 걸린 시간 전부를 잰다.
        { provide: APP_INTERCEPTOR, useClass: RequestLogInterceptor },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
        { provide: APP_FILTER, useClass: ApiErrorFilter },
      ],
    };
  }
}
