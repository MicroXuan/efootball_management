import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { RefreshRequest, WechatLoginRequest } from '@efm/contracts';
import {
  LogoutRequestSchema,
  RefreshRequestSchema,
  WechatLoginRequestSchema
} from '@efm/contracts';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { AuthService } from './auth.service.js';

type HttpRequest = {
  ip?: string;
  headers: { 'user-agent'?: string };
};

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('wechat')
  @HttpCode(200)
  login(
    @Body(new ZodValidationPipe(WechatLoginRequestSchema)) body: WechatLoginRequest,
    @Req() request: HttpRequest
  ) {
    return this.authService.loginWithWechat(body.code, this.context(request));
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(
    @Body(new ZodValidationPipe(RefreshRequestSchema)) body: RefreshRequest,
    @Req() request: HttpRequest
  ) {
    return this.authService.refresh(body.refreshToken, this.context(request));
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Body(new ZodValidationPipe(LogoutRequestSchema)) body: RefreshRequest) {
    return this.authService.logout(body.refreshToken);
  }

  private context(request: HttpRequest) {
    return {
      ...(request.ip ? { ipAddress: request.ip } : {}),
      ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {})
    };
  }
}
