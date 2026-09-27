import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { AuthTokenResponse } from '@efm/contracts';
import type { Prisma } from '../generated/prisma/client.js';
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
    const existing = await this.prisma.user.findUnique({ where: { wechatOpenId: identity.openId } });
    const user = existing?.publicUserNo
      ? identity.unionId && existing.wechatUnionId !== identity.unionId
        ? await this.prisma.user.update({
            where: { id: existing.id },
            data: { wechatUnionId: identity.unionId }
          })
        : existing
      : await this.prisma.$transaction((transaction) =>
          this.findOrCreateNumberedUser(transaction, identity)
        );
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

  private async findOrCreateNumberedUser(
    transaction: Prisma.TransactionClient,
    identity: { openId: string; unionId?: string }
  ) {
    await transaction.$queryRaw`
      SELECT \`key\` FROM public_user_number_sequences
      WHERE \`key\` = 'public-users' FOR UPDATE
    `;
    const current = await transaction.user.findUnique({
      where: { wechatOpenId: identity.openId }
    });
    if (current?.publicUserNo) {
      if (identity.unionId && current.wechatUnionId !== identity.unionId) {
        return transaction.user.update({
          where: { id: current.id },
          data: { wechatUnionId: identity.unionId }
        });
      }
      return current;
    }
    const sequence = await transaction.publicUserNumberSequence.findUnique({
      where: { key: 'public-users' }
    });
    if (!sequence || sequence.nextValue > 999_999) {
      throw new UnauthorizedException({
        code: 'PUBLIC_USER_NUMBER_UNAVAILABLE',
        message: 'No public user number is available'
      });
    }
    const publicUserNo = String(sequence.nextValue).padStart(6, '0');
    await transaction.publicUserNumberSequence.update({
      where: { key: 'public-users' },
      data: { nextValue: { increment: 1 } }
    });

    return current
      ? transaction.user.update({
          where: { id: current.id },
          data: {
            publicUserNo,
            ...(identity.unionId ? { wechatUnionId: identity.unionId } : {})
          }
        })
      : transaction.user.create({
          data: {
            wechatOpenId: identity.openId,
            wechatUnionId: identity.unionId ?? null,
            publicUserNo,
            displayName: '实况玩家'
          }
        });
  }
}
