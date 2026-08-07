import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthController } from './auth/auth.controller';
import { AuthRepository } from './auth/auth.repository';
import { AuthService } from './auth/auth.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { PermissionsGuard } from './auth/permissions.guard';
import { ApiErrorFilter } from './common/api-error.filter';
import { AuditRepository } from './common/audit.repository';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { IdempotencyRepository } from './common/idempotency.repository';
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
import { HealthController } from './health/health.controller';
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
import { situationProviderFactory } from './situation/situation-provider.provider';
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
      controllers: [
        HealthController,
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
        ProviderJobController,
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
        FactService,
        ProviderQueryService,
        situationProviderFactory,
        objectStorageProvider,
        IdempotencyRepository,
        // Registration order matters: authentication before permission checks;
        // the idempotency interceptor runs after both guards.
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
        { provide: APP_FILTER, useClass: ApiErrorFilter },
      ],
    };
  }
}
