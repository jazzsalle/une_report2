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
import { HealthController } from './health/health.controller';
import { OrganizationsController, RolesController, UsersController } from './iam/iam.controller';
import { IamRepository } from './iam/iam.repository';
import { IamService } from './iam/iam.service';
import { PlanController } from './plan/plan.controller';
import { PlanRepository } from './plan/plan.repository';
import { PlanService } from './plan/plan.service';

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
