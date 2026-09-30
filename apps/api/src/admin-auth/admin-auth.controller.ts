import { Body, Controller, Get, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { AdminLoginRequest, AdminRefreshRequest } from '@efm/contracts';
import {
  AdminLoginRequestSchema,
  AdminLogoutRequestSchema,
  AdminRefreshRequestSchema
} from '@efm/contracts';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { AdminAuthGuard } from './admin-auth.guard.js';
import { AdminAuthService } from './admin-auth.service.js';
import { CurrentAdmin } from './current-admin.decorator.js';
import type { CurrentAdminIdentity } from './current-admin.decorator.js';

type HttpRequest = {
  ip?: string;
  headers: { 'user-agent'?: string };
};

@Controller('admin/auth')
export class AdminAuthController {
  constructor(@Inject(AdminAuthService) private readonly auth: AdminAuthService) {}

  @Post('login')
  @HttpCode(200)
  login(
    @Body(new ZodValidationPipe(AdminLoginRequestSchema)) body: AdminLoginRequest,
    @Req() request: HttpRequest
  ) {
    return this.auth.login(body.username, body.password, this.context(request));
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(
    @Body(new ZodValidationPipe(AdminRefreshRequestSchema)) body: AdminRefreshRequest,
    @Req() request: HttpRequest
  ) {
    return this.auth.refresh(body.refreshToken, this.context(request));
  }

  @Post('logout')
  @HttpCode(200)
  logout(
    @Body(new ZodValidationPipe(AdminLogoutRequestSchema)) body: AdminRefreshRequest
  ) {
    return this.auth.logout(body.refreshToken);
  }

  @Get('me')
  @UseGuards(AdminAuthGuard)
  me(@CurrentAdmin() admin: CurrentAdminIdentity) {
    return this.auth.me(admin.id);
  }

  private context(request: HttpRequest) {
    return {
      ...(request.ip ? { ipAddress: request.ip } : {}),
      ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {})
    };
  }
}
