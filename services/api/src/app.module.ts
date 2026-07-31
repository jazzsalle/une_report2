import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth/auth.controller';
import { AuthRepository } from './auth/auth.repository';
import { AuthService } from './auth/auth.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { PermissionsGuard } from './auth/permissions.guard';
import { ApiErrorFilter } from './common/api-error.filter';
import { API_CONFIG, loadApiConfig, type ApiConfig } from './config/api-config';
import { DatabaseService } from './db/database.service';
import { HealthController } from './health/health.controller';
import { OrganizationsController, RolesController, UsersController } from './iam/iam.controller';
import { IamRepository } from './iam/iam.repository';
import { IamService } from './iam/iam.service';

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
      ],
      providers: [
        { provide: API_CONFIG, useValue: config },
        DatabaseService,
        AuthRepository,
        AuthService,
        IamRepository,
        IamService,
        // Registration order matters: authentication before permission checks.
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: APP_FILTER, useClass: ApiErrorFilter },
      ],
    };
  }
}
