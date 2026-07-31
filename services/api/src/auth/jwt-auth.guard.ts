import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { authErrors } from '../common/api-error';
import { IS_PUBLIC } from '../common/decorators';
import type { ApiRequest } from '../common/request-context';
import { API_CONFIG, type ApiConfig } from '../config/api-config';
import { verifyAccessToken } from './tokens';

/** Global guard: every non-@Public route requires a valid UNE JWT. The
 * tenant comes exclusively from the verified tid claim — client-supplied
 * tenant headers/params are never trusted (design §2.2). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<ApiRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ') || !this.config.jwtSecret) {
      throw authErrors.unauthenticated();
    }
    req.auth = verifyAccessToken(this.config.jwtSecret, header.slice('Bearer '.length));
    return true;
  }
}
