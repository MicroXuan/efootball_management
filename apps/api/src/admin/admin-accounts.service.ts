import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type {
  CreateAdminAccountRequest,
  CreateAdminLeagueGrantRequest,
  ResetAdminPasswordRequest,
  UpdateAdminAccountRequest
} from '@efm/contracts';
import { PasswordService } from '../admin-auth/password.service.js';
import type { AdminAccount, AdminLeagueRole, League } from '../generated/prisma/client.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { AdminError } from './admin.errors.js';
import { AdminMutationReceiptService } from './admin-mutation-receipt.service.js';
import { AuditLogService } from './audit-log.service.js';

@Injectable()
export class AdminAccountsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(AdminMutationReceiptService) private readonly receipts: AdminMutationReceiptService,
    @Inject(AuditLogService) private readonly audit: AuditLogService
  ) {}

  async list() {
    const accounts = await this.prisma.adminAccount.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }]
    });
    return { items: accounts.map((account) => this.account(account)) };
  }

  create(actorAdminId: string, input: CreateAdminAccountRequest, key: string) {
    return this.receipts.execute(actorAdminId, 'admin.account.create', key, async (transaction) => {
      try {
        const created = await transaction.adminAccount.create({
          data: {
            username: input.username,
            displayName: input.displayName,
            passwordHash: await this.passwords.hash(input.password),
            platformRole: 'LEAGUE_MANAGER'
          }
        });
        await this.audit.record(transaction, {
          actorAdminId,
          action: 'admin.account.create',
          resourceType: 'AdminAccount',
          resourceId: created.id,
          metadata: { username: created.username, displayName: created.displayName }
        });
        return this.account(created);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException({
            code: 'ADMIN_USERNAME_ALREADY_EXISTS',
            message: 'Administrator username already exists'
          });
        }
        throw error;
      }
    });
  }

  update(
    actorAdminId: string,
    adminId: string,
    input: UpdateAdminAccountRequest,
    key: string
  ) {
    return this.receipts.execute(actorAdminId, `admin.account.update:${adminId}`, key, async (transaction) => {
      const result = await transaction.adminAccount.updateMany({
        where: { id: adminId, version: input.expectedVersion },
        data: {
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          version: { increment: 1 }
        }
      });
      if (result.count !== 1) throw this.versionOrMissing();
      if (input.status === 'DISABLED') {
        await transaction.adminSession.updateMany({
          where: { adminId, revokedAt: null },
          data: { revokedAt: new Date() }
        });
      }
      const updated = await transaction.adminAccount.findUniqueOrThrow({ where: { id: adminId } });
      await this.audit.record(transaction, {
        actorAdminId,
        action: 'admin.account.update',
        resourceType: 'AdminAccount',
        resourceId: adminId,
        metadata: {
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.status !== undefined ? { status: input.status } : {})
        }
      });
      return this.account(updated);
    });
  }

  async resetPassword(
    actorAdminId: string,
    adminId: string,
    input: ResetAdminPasswordRequest,
    key: string
  ) {
    const passwordHash = await this.passwords.hash(input.password);
    return this.receipts.execute(actorAdminId, `admin.password.reset:${adminId}`, key, async (transaction) => {
      const result = await transaction.adminAccount.updateMany({
        where: { id: adminId, version: input.expectedVersion },
        data: {
          passwordHash,
          failedLoginCount: 0,
          lockedUntil: null,
          version: { increment: 1 }
        }
      });
      if (result.count !== 1) throw this.versionOrMissing();
      await transaction.adminSession.updateMany({
        where: { adminId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
      const updated = await transaction.adminAccount.findUniqueOrThrow({ where: { id: adminId } });
      await this.audit.record(transaction, {
        actorAdminId,
        action: 'admin.password.reset',
        resourceType: 'AdminAccount',
        resourceId: adminId
      });
      return this.account(updated);
    });
  }

  grantLeague(
    actorAdminId: string,
    adminId: string,
    input: CreateAdminLeagueGrantRequest,
    key: string
  ) {
    return this.receipts.execute(
      actorAdminId,
      `admin.league-grant.create:${adminId}:${input.leagueId}`,
      key,
      async (transaction) => {
        const admin = await transaction.adminAccount.findUnique({ where: { id: adminId } });
        if (!admin) throw new AdminError('ADMIN_ACCOUNT_NOT_FOUND', 'Administrator was not found', 404);
        const league = await transaction.league.findUnique({ where: { id: input.leagueId } });
        if (!league) throw new AdminError('LEAGUE_NOT_FOUND', 'League was not found', 404);
        const grant = await transaction.adminLeagueRole.upsert({
          where: {
            adminId_leagueId_role: {
              adminId,
              leagueId: input.leagueId,
              role: 'LEAGUE_MANAGER'
            }
          },
          create: {
            adminId,
            leagueId: input.leagueId,
            role: 'LEAGUE_MANAGER',
            grantedById: actorAdminId
          },
          update: {
            revokedAt: null,
            grantedById: actorAdminId,
            version: { increment: 1 }
          }
        });
        await this.audit.record(transaction, {
          actorAdminId,
          leagueId: input.leagueId,
          action: 'admin.league-grant.create',
          resourceType: 'AdminLeagueRole',
          resourceId: grant.id,
          metadata: { adminId, role: input.role }
        });
        return this.grant(grant, league);
      }
    );
  }

  revokeLeague(
    actorAdminId: string,
    adminId: string,
    grantId: string,
    expectedVersion: number,
    key: string
  ) {
    return this.receipts.execute(actorAdminId, `admin.league-grant.revoke:${grantId}`, key, async (transaction) => {
      const existing = await transaction.adminLeagueRole.findFirst({
        where: { id: grantId, adminId },
        include: { league: true }
      });
      if (!existing) throw new AdminError('ADMIN_LEAGUE_GRANT_NOT_FOUND', 'League grant was not found', 404);
      const result = await transaction.adminLeagueRole.updateMany({
        where: { id: grantId, adminId, version: expectedVersion, revokedAt: null },
        data: { revokedAt: new Date(), version: { increment: 1 } }
      });
      if (result.count !== 1) throw this.versionOrMissing();
      const revoked = await transaction.adminLeagueRole.findUniqueOrThrow({ where: { id: grantId } });
      await this.audit.record(transaction, {
        actorAdminId,
        leagueId: existing.leagueId,
        action: 'admin.league-grant.revoke',
        resourceType: 'AdminLeagueRole',
        resourceId: grantId,
        metadata: { adminId }
      });
      return this.grant(revoked, existing.league);
    });
  }

  private account(account: AdminAccount) {
    return {
      id: account.id,
      username: account.username,
      displayName: account.displayName,
      status: account.status,
      failedLoginCount: account.failedLoginCount,
      lockedUntil: account.lockedUntil?.toISOString() ?? null,
      lastLoginAt: account.lastLoginAt?.toISOString() ?? null,
      version: account.version,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString()
    };
  }

  private grant(grant: AdminLeagueRole, league: League) {
    return {
      id: grant.id,
      adminId: grant.adminId,
      leagueId: grant.leagueId,
      leagueName: league.name,
      role: 'LEAGUE_MANAGER' as const,
      grantedById: grant.grantedById,
      createdAt: grant.createdAt.toISOString(),
      revokedAt: grant.revokedAt?.toISOString() ?? null,
      version: grant.version
    };
  }

  private versionOrMissing() {
    return new AdminError('VERSION_CONFLICT', 'Administrator resource has changed', 409);
  }
}
