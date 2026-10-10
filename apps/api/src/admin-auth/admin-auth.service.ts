import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { AdminAuthResponse, AdminMeResponse } from '@efm/contracts';
import { PrismaService } from '../database/prisma.service.js';
import type { AdminTokenContext } from './admin-token.service.js';
import { AdminTokenService } from './admin-token.service.js';
import { PasswordService } from './password.service.js';

const MAX_FAILED_LOGINS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1_000;
const DUMMY_PASSWORD_HASH = '$2b$10$7ZbCId0C9KnXcjmAYVzQNeRx7GgQCOkIO86MiD5dO.XAqPLXP7v6.';

@Injectable()
export class AdminAuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(AdminTokenService) private readonly tokens: AdminTokenService
  ) {}

  async login(
    username: string,
    password: string,
    context: AdminTokenContext
  ): Promise<AdminAuthResponse> {
    const admin = await this.prisma.adminAccount.findUnique({ where: { username } });
    const validPassword = await this.passwords.verify(
      password,
      admin?.passwordHash ?? DUMMY_PASSWORD_HASH
    );
    const now = new Date();

    if (!admin) throw this.credentialsError();
    if (admin.status !== 'ACTIVE' || (admin.lockedUntil && admin.lockedUntil > now)) {
      throw this.credentialsError();
    }
    if (!validPassword) {
      const failedLoginCount = admin.failedLoginCount + 1;
      await this.prisma.adminAccount.update({
        where: { id: admin.id },
        data: {
          failedLoginCount,
          lockedUntil: failedLoginCount >= MAX_FAILED_LOGINS
            ? new Date(now.getTime() + LOCK_DURATION_MS)
            : null
        }
      });
      throw this.credentialsError();
    }

    const authenticated = await this.prisma.adminAccount.update({
      where: { id: admin.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now }
    });
    return this.tokens.issuePair(authenticated, context);
  }

  refresh(refreshToken: string, context: AdminTokenContext): Promise<AdminAuthResponse> {
    return this.tokens.rotate(refreshToken, context);
  }

  async logout(refreshToken: string): Promise<{ ok: true }> {
    await this.tokens.revoke(refreshToken);
    return { ok: true };
  }

  async me(adminId: string): Promise<AdminMeResponse> {
    const admin = await this.prisma.adminAccount.findUniqueOrThrow({
      where: { id: adminId },
      include: {
        leagueRoles: {
          where: { revokedAt: null, league: { isDeleted: false } },
          include: { league: { select: { name: true } } }
        }
      }
    });

    return {
      admin: {
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
      },
      platformAdmin: admin.platformRole === 'PLATFORM_ADMIN',
      leagueGrants: admin.leagueRoles.map((grant) => ({
        leagueId: grant.leagueId,
        leagueName: grant.league.name,
        role: 'LEAGUE_MANAGER'
      }))
    };
  }

  private credentialsError(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'ADMIN_CREDENTIALS_INVALID',
      message: 'Administrator credentials are invalid'
    });
  }
}
