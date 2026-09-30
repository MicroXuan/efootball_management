import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AdminAccountSummary, AdminAuthResponse } from '@efm/contracts';
import type { AdminRole, AdminStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../database/prisma.service.js';

const ACCESS_EXPIRES_IN_SECONDS = 15 * 60;
const REFRESH_EXPIRES_IN_SECONDS = 30 * 24 * 60 * 60;

export const ADMIN_TOKEN_CONFIG = Symbol('ADMIN_TOKEN_CONFIG');

export type AdminTokenConfig = {
  accessSecret: string;
  refreshPepper: string;
};

export type AdminTokenAccount = {
  id: string;
  username: string;
  displayName: string;
  status: AdminStatus;
  platformRole: AdminRole | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type AdminTokenContext = {
  ipAddress?: string;
  userAgent?: string;
};

type RotationOutcome =
  | { kind: 'success'; pair: AdminAuthResponse }
  | { kind: 'invalid' }
  | { kind: 'reused' }
  | { kind: 'disabled' };

@Injectable()
export class AdminTokenService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(ADMIN_TOKEN_CONFIG) private readonly config: AdminTokenConfig
  ) {}

  async issuePair(
    admin: AdminTokenAccount,
    context: AdminTokenContext
  ): Promise<AdminAuthResponse> {
    this.assertActive(admin.status);
    const refreshToken = this.generateRefreshToken();

    await this.prisma.adminSession.create({
      data: {
        adminId: admin.id,
        tokenHash: this.hashRefreshToken(refreshToken),
        familyId: randomUUID(),
        expiresAt: this.refreshExpiry(),
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null
      }
    });

    return this.buildPair(admin, refreshToken);
  }

  async rotate(refreshToken: string, context: AdminTokenContext): Promise<AdminAuthResponse> {
    const tokenHash = this.hashRefreshToken(refreshToken);
    const outcome = await this.prisma.$transaction<RotationOutcome>(async (transaction) => {
      const session = await transaction.adminSession.findUnique({
        where: { tokenHash },
        include: { admin: true }
      });
      if (!session) return { kind: 'invalid' };

      if (session.revokedAt) {
        await transaction.adminSession.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: new Date() }
        });
        return { kind: 'reused' };
      }

      if (session.expiresAt.getTime() <= Date.now()) {
        await transaction.adminSession.update({
          where: { id: session.id },
          data: { revokedAt: new Date() }
        });
        return { kind: 'invalid' };
      }

      if (session.admin.status !== 'ACTIVE') {
        await transaction.adminSession.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: new Date() }
        });
        return { kind: 'disabled' };
      }

      const replacementToken = this.generateRefreshToken();
      const replacement = await transaction.adminSession.create({
        data: {
          adminId: session.adminId,
          tokenHash: this.hashRefreshToken(replacementToken),
          familyId: session.familyId,
          expiresAt: this.refreshExpiry(),
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null
        }
      });
      await transaction.adminSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date(), replacedBySessionId: replacement.id }
      });

      return {
        kind: 'success',
        pair: await this.buildPair(session.admin, replacementToken)
      };
    });

    if (outcome.kind === 'success') return outcome.pair;
    if (outcome.kind === 'reused') {
      throw this.error('ADMIN_SESSION_REUSED', 'Administrator refresh token reuse detected');
    }
    if (outcome.kind === 'disabled') {
      throw this.error('ADMIN_REFRESH_INVALID', 'Administrator refresh token is invalid or expired');
    }
    throw this.error('ADMIN_REFRESH_INVALID', 'Administrator refresh token is invalid or expired');
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.prisma.adminSession.updateMany({
      where: { tokenHash: this.hashRefreshToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }

  private async buildPair(
    admin: AdminTokenAccount,
    refreshToken: string
  ): Promise<AdminAuthResponse> {
    const accessToken = await this.jwt.signAsync(
      {
        sub: admin.id,
        actor: 'ADMIN',
        status: admin.status,
        platformRole: admin.platformRole
      },
      { secret: this.config.accessSecret, expiresIn: ACCESS_EXPIRES_IN_SECONDS }
    );

    return {
      accessToken,
      expiresInSeconds: ACCESS_EXPIRES_IN_SECONDS,
      refreshToken,
      refreshExpiresInSeconds: REFRESH_EXPIRES_IN_SECONDS,
      admin: this.summary(admin)
    };
  }

  private summary(admin: AdminTokenAccount): AdminAccountSummary {
    return {
      id: admin.id,
      username: admin.username,
      displayName: admin.displayName,
      status: admin.status,
      failedLoginCount: admin.failedLoginCount,
      lockedUntil: admin.lockedUntil?.toISOString() ?? null,
      lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
      version: admin.version,
      createdAt: admin.createdAt.toISOString(),
      updatedAt: admin.updatedAt.toISOString()
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

  private assertActive(status: AdminStatus): void {
    if (status !== 'ACTIVE') throw this.error('ADMIN_REFRESH_INVALID', 'Administrator is unavailable');
  }

  private error(code: string, message: string): UnauthorizedException {
    return new UnauthorizedException({ code, message });
  }
}
