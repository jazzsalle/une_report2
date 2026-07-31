import { Body, Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { authErrors } from '../common/api-error';
import { Public } from '../common/decorators';
import { ok, type SuccessEnvelope } from '../common/envelope';
import type { ApiRequest } from '../common/request-context';
import { AuthService, type RequestMeta, type TokenBundle, type UserContext } from './auth.service';

function metaOf(req: ApiRequest): RequestMeta {
  const userAgent = req.headers['user-agent'];
  return {
    correlationId: req.correlationId,
    ip: req.ip,
    userAgent: typeof userAgent === 'string' ? userAgent : undefined,
  };
}

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  /** UNE-AUTH-001 */
  @Post('sso/exchange')
  @Public()
  @HttpCode(200)
  async exchange(
    @Req() req: ApiRequest,
    @Body() body: { externalToken?: unknown } | undefined,
  ): Promise<SuccessEnvelope<TokenBundle>> {
    return ok(req, await this.auth.exchange(body?.externalToken, metaOf(req)));
  }

  /** UNE-AUTH-002 */
  @Get('me')
  async me(@Req() req: ApiRequest): Promise<SuccessEnvelope<UserContext>> {
    if (!req.auth) throw authErrors.unauthenticated();
    return ok(req, await this.auth.me(req.auth));
  }

  /** UNE-AUTH-003 */
  @Post('refresh')
  @Public()
  @HttpCode(200)
  async refresh(
    @Req() req: ApiRequest,
    @Body() body: { refreshToken?: unknown } | undefined,
  ): Promise<SuccessEnvelope<{ accessToken: string; refreshToken: string; expiresIn: number }>> {
    return ok(req, await this.auth.refresh(body?.refreshToken, metaOf(req)));
  }

  /** UNE-AUTH-004 */
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: ApiRequest): Promise<SuccessEnvelope<null>> {
    if (!req.auth) throw authErrors.unauthenticated();
    await this.auth.logout(req.auth, metaOf(req));
    return ok(req, null);
  }
}
