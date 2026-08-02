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
import { DocumentImportService } from './document/document-import.service';
import { DocumentRepository } from './document/document.repository';
import { DocumentService } from './document/document.service';
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
        // HTTP 표면이 없는 애플리케이션 서비스(업로드 API는 CC-160 소유).
        // 테스트/E2E가 편집 대상 문서를 얻는 유일한 경로다.
        DocumentImportService,
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
