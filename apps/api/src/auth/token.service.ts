import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthTokenResponse } from '@efm/contracts';
import type { UserStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../database/prisma.service.js';

const ACCESS_EXPIRES_IN_SECONDS = 15 * 60;
const REFRESH_EXPIRES_IN_SECONDS = 30 * 24 * 60 * 60;

export const TOKEN_CONFIG = Symbol('TOKEN_CONFIG');

export type TokenConfig = {
  accessSecret: string;
  refreshPepper: string;
};

export type TokenUser = {
  id: string;
  status: UserStatus;
};

export type TokenContext = {
  ipAddress?: string;
  userAgent?: string;
};

type RotationOutcome =
  | { kind: 'success'; pair: AuthTokenResponse }
  | { kind: 'invalid' }
  | { kind: 'reused' }
  | { kind: 'disabled' };

@Injectable()
export class TokenService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(TOKEN_CONFIG) private readonly config: TokenConfig
  ) {}

  async issuePair(user: TokenUser, context: TokenContext): Promise<AuthTokenResponse> {
    this.assertActive(user.status);
    const refreshToken = this.generateRefreshToken();
    const expiresAt = this.refreshExpiry();

    await this.prisma.refreshSession.create({
      data: {
        userId: user.id,
        tokenHash: this.hashRefreshToken(refreshToken),
        familyId: randomUUID(),
        expiresAt,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null
      }
    });

    return this.buildPair(user, refreshToken);
  }

  async rotate(refreshToken: string, context: TokenContext): Promise<AuthTokenResponse> {
    const tokenHash = this.hashRefreshToken(refreshToken);
    const outcome = await this.prisma.$transaction<RotationOutcome>(async (transaction) => {
      const session = await transaction.refreshSession.findUnique({
        where: { tokenHash },
        include: { user: true }
      });
      if (!session) return { kind: 'invalid' };

      if (session.revokedAt) {
        await transaction.refreshSession.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: new Date() }
        });
        return { kind: 'reused' };
      }

      if (session.expiresAt.getTime() <= Date.now()) {
        await transaction.refreshSession.update({
          where: { id: session.id },
          data: { revokedAt: new Date() }
        });
        return { kind: 'invalid' };
      }

      if (session.user.status !== 'ACTIVE') {
        await transaction.refreshSession.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: new Date() }
        });
        return { kind: 'disabled' };
      }

      const replacementToken = this.generateRefreshToken();
      const replacement = await transaction.refreshSession.create({
        data: {
          userId: session.userId,
          tokenHash: this.hashRefreshToken(replacementToken),
          familyId: session.familyId,
          expiresAt: this.refreshExpiry(),
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null
        }
      });
      await transaction.refreshSession.update({
        where: { id: session.id },
        data: {
          revokedAt: new Date(),
          replacedBySessionId: replacement.id
        }
      });

      return {
        kind: 'success',
        pair: await this.buildPair(session.user, replacementToken)
      };
    });

    if (outcome.kind === 'success') return outcome.pair;
    if (outcome.kind === 'reused') {
      throw this.authError('AUTH_SESSION_REUSED', 'Refresh token reuse detected');
    }
    if (outcome.kind === 'disabled') {
      throw this.authError('AUTH_USER_DISABLED', 'User account is disabled');
    }
    throw this.authError('AUTH_REFRESH_INVALID', 'Refresh token is invalid or expired');
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: {
        tokenHash: this.hashRefreshToken(refreshToken),
        revokedAt: null
      },
      data: { revokedAt: new Date() }
    });
  }

  private async buildPair(user: TokenUser, refreshToken: string): Promise<AuthTokenResponse> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, status: user.status },
      { secret: this.config.accessSecret, expiresIn: ACCESS_EXPIRES_IN_SECONDS }
    );

    return {
      accessToken,
      expiresInSeconds: ACCESS_EXPIRES_IN_SECONDS,
      refreshToken,
      refreshExpiresInSeconds: REFRESH_EXPIRES_IN_SECONDS
    };
  }

  private generateRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

  private hashRefreshToken(token: string): string {
    return createHmac('sha256', this.config.refreshPepper).update(token).digest('hex');
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + REFRESH_EXPIRES_IN_SECONDS * 1_000);
  }

  private assertActive(status: UserStatus): void {
    if (status !== 'ACTIVE') {
      throw this.authError('AUTH_USER_DISABLED', 'User account is disabled');
    }
  }

  private authError(code: string, message: string): UnauthorizedException {
    return new UnauthorizedException({ code, message });
  }
}
