import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { AuthTokenResponse } from '@efm/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { TokenService } from './token.service.js';
import { WECHAT_GATEWAY } from './wechat.gateway.js';
import type { WechatGateway } from './wechat.gateway.js';

export type AuthRequestContext = {
  ipAddress?: string;
  userAgent?: string;
};

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WECHAT_GATEWAY) private readonly wechatGateway: WechatGateway,
    @Inject(TokenService) private readonly tokenService: TokenService
  ) {}

  async loginWithWechat(code: string, context: AuthRequestContext): Promise<AuthTokenResponse> {
    const identity = await this.wechatGateway.exchangeCode(code);
    const user = await this.prisma.user.upsert({
      where: { wechatOpenId: identity.openId },
      update: identity.unionId ? { wechatUnionId: identity.unionId } : {},
      create: {
        wechatOpenId: identity.openId,
        wechatUnionId: identity.unionId ?? null,
        displayName: '实况玩家'
      }
    });
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException({
        code: 'AUTH_USER_DISABLED',
        message: 'User account is disabled'
      });
    }

    return this.tokenService.issuePair(user, context);
  }

  refresh(refreshToken: string, context: AuthRequestContext): Promise<AuthTokenResponse> {
    return this.tokenService.rotate(refreshToken, context);
  }

  async logout(refreshToken: string): Promise<{ ok: true }> {
    await this.tokenService.revoke(refreshToken);
    return { ok: true };
  }
}
