import { Inject, Injectable } from '@nestjs/common';
import {
  AcquirePlayerRequestSchema,
  EmergencyCorrectRosterRequestSchema,
  ReleasePlayerRequestSchema,
  TransferPlayerRequestSchema,
  UpgradePlayerCardRequestSchema,
  type AcquirePlayerRequest,
  type EmergencyCorrectRosterRequest,
  type ReleasePlayerRequest,
  type RosterMutationOwnership,
  type RosterMutationResponse,
  type TransferPlayerRequest,
  type UpgradePlayerCardRequest
} from '@efm/contracts';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { LeagueRosterError } from './league-roster.errors.js';
import { RosterLockRepository } from './roster-lock.repository.js';
import { SalaryRulesService } from './salary-rules.service.js';
import { TransferWindowsService } from './transfer-windows.service.js';

const MAX_ROSTER_SIZE = 25;

@Injectable()
export class RosterTransactionsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(AdminMutationReceiptService) private readonly receipts: AdminMutationReceiptService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(SalaryRulesService) private readonly salaryRules: SalaryRulesService,
    @Inject(TransferWindowsService) private readonly transferWindows: TransferWindowsService,
    @Inject(RosterLockRepository) private readonly locks: RosterLockRepository
  ) {}

  async acquire(raw: AcquirePlayerRequest, adminId: string, at = new Date()) {
    const input = AcquirePlayerRequestSchema.parse(raw);
    const scope = await this.loadScope(input.seasonId, input.targetLeagueTeamId);
    await this.authorization.requireLeagueManager(adminId, scope.leagueId);

    try {
      return await this.receipts.execute(adminId, 'ROSTER_PLAYER_ACQUIRE', input.idempotencyKey,
        async (tx) => {
          await this.locks.lockTeam(tx, input.targetLeagueTeamId);
          const lockedScope = await this.loadScopeWithClient(
            tx,
            input.seasonId,
            input.targetLeagueTeamId
          );
          await this.transferWindows.requireAllowedWithClient(tx, input.seasonId, 'BUY', at);

          const build = await tx.playerCardAutoBuild.findFirst({
            where: { playerCardId: input.playerCardId },
            orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
            include: { playerCard: true }
          });
          if (!build) {
            throw new LeagueRosterError(
              'PLAYER_AUTO_BUILD_MISSING',
              'The selected player card has no automatic build',
              422
            );
          }
          if (build.dtRating === null) {
            throw new LeagueRosterError(
              'PLAYER_DT_RATING_MISSING',
              'The selected player card has no DT rating',
              422
            );
          }

          const footballPlayerId = build.playerCard.playerId;
          await this.locks.lockOwnership(tx, lockedScope.leagueId, footballPlayerId);
          const existing = await tx.leaguePlayerOwnership.findUnique({
            where: {
              leagueId_footballPlayerId: { leagueId: lockedScope.leagueId, footballPlayerId }
            }
          });
          if (existing?.status === 'ACTIVE') {
            throw this.playerAlreadyOwned(existing.leagueTeamId);
          }

          const roster = await tx.leaguePlayerOwnership.aggregate({
            where: { leagueTeamId: input.targetLeagueTeamId, status: 'ACTIVE' },
            _count: { _all: true },
            _sum: { salaryMinor: true }
          });
          if (roster._count._all >= MAX_ROSTER_SIZE) {
            throw new LeagueRosterError(
              'TEAM_ROSTER_FULL',
              `A team may register at most ${MAX_ROSTER_SIZE} players`,
              409,
              { rosterCount: roster._count._all, rosterLimit: MAX_ROSTER_SIZE }
            );
          }

          const quote = await this.salaryRules.quoteWithClient(
            tx,
            lockedScope.leagueId,
            build.dtRating,
            at
          );
          const currentSalaryMinor = roster._sum.salaryMinor ?? 0;
          const projectedSalaryMinor = currentSalaryMinor + quote.salaryMinor;
          if (projectedSalaryMinor > quote.salaryCapMinor) {
            throw new LeagueRosterError(
              'TEAM_SALARY_CAP_EXCEEDED',
              'The acquisition would exceed the team salary cap',
              409,
              {
                currentSalaryMinor,
                playerSalaryMinor: quote.salaryMinor,
                projectedSalaryMinor,
                salaryCapMinor: quote.salaryCapMinor
              }
            );
          }

          const ownership = existing
            ? await tx.leaguePlayerOwnership.update({
              where: { id: existing.id },
              data: {
                leagueTeamId: input.targetLeagueTeamId,
                currentPlayerCardId: input.playerCardId,
                dtRatingSnapshot: build.dtRating,
                salaryRuleVersionId: quote.salaryRuleVersionId,
                salaryMinor: quote.salaryMinor,
                acquiredAt: at,
                status: 'ACTIVE',
                version: { increment: 1 }
              }
            })
            : await tx.leaguePlayerOwnership.create({
              data: {
                leagueId: lockedScope.leagueId,
                leagueTeamId: input.targetLeagueTeamId,
                footballPlayerId,
                currentPlayerCardId: input.playerCardId,
                dtRatingSnapshot: build.dtRating,
                salaryRuleVersionId: quote.salaryRuleVersionId,
                salaryMinor: quote.salaryMinor,
                acquiredAt: at
              }
            });
          const transaction = await tx.rosterTransaction.create({
            data: {
              leagueId: lockedScope.leagueId,
              seasonId: input.seasonId,
              type: 'BUY',
              footballPlayerId,
              targetLeagueTeamId: input.targetLeagueTeamId,
              newPlayerCardId: input.playerCardId,
              newSalaryMinor: quote.salaryMinor,
              amountMinor: input.amountMinor,
              reason: input.reason,
              createdByAdminId: adminId,
              createdAt: at
            }
          });
          await tx.financeLedgerEntry.create({
            data: {
              leagueId: lockedScope.leagueId,
              leagueTeamId: input.targetLeagueTeamId,
              rosterTransactionId: transaction.id,
              direction: 'DEBIT',
              type: 'PLAYER_PURCHASE',
              amountMinor: input.amountMinor,
              note: input.reason,
              createdAt: at
            }
          });
          await this.audit.record(tx, {
            actorAdminId: adminId,
            leagueId: lockedScope.leagueId,
            action: 'ROSTER_PLAYER_ACQUIRED',
            resourceType: 'LEAGUE_PLAYER_OWNERSHIP',
            resourceId: ownership.id,
            reason: input.reason,
            metadata: {
              seasonId: input.seasonId,
              leagueTeamId: input.targetLeagueTeamId,
              footballPlayerId,
              playerCardId: input.playerCardId,
              amountMinor: input.amountMinor
            }
          });
          await this.setRosterStatus(
            tx,
            input.targetLeagueTeamId,
            projectedSalaryMinor,
            quote.salaryCapMinor
          );

          return this.result(ownership, transaction, {
            rosterCount: roster._count._all + 1,
            salaryMinor: projectedSalaryMinor,
            salaryCapMinor: quote.salaryCapMinor
          });
        }, input);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.playerAlreadyOwned();
      }
      throw error;
    }
  }

  async release(raw: ReleasePlayerRequest, adminId: string, at = new Date()) {
    const input = ReleasePlayerRequestSchema.parse(raw);
    const current = await this.prisma.leaguePlayerOwnership.findUnique({
      where: { id: input.ownershipId }
    });
    if (!current) {
      throw new LeagueRosterError('ROSTER_ENTRY_NOT_FOUND', 'Roster entry was not found', 404);
    }
    const season = await this.prisma.leagueSeason.findUnique({ where: { id: input.seasonId } });
    if (!season || season.leagueId !== current.leagueId) {
      throw new LeagueRosterError('ROSTER_SCOPE_MISMATCH', 'Season and roster entry differ', 409);
    }
    await this.authorization.requireLeagueManager(adminId, current.leagueId);

    return this.receipts.execute(adminId, 'ROSTER_PLAYER_RELEASE', input.idempotencyKey,
      async (tx) => {
        await this.locks.lockTeam(tx, current.leagueTeamId);
        await this.locks.lockOwnership(tx, current.leagueId, current.footballPlayerId);
        await this.transferWindows.requireAllowedWithClient(tx, input.seasonId, 'SELL', at);
        const locked = await tx.leaguePlayerOwnership.findUnique({ where: { id: input.ownershipId } });
        if (!locked) {
          throw new LeagueRosterError('ROSTER_ENTRY_NOT_FOUND', 'Roster entry was not found', 404);
        }
        if (locked.status !== 'ACTIVE') {
          throw new LeagueRosterError('ROSTER_ENTRY_NOT_ACTIVE', 'Roster entry is not active', 409);
        }
        if (locked.version !== input.expectedVersion) {
          throw new LeagueRosterError('VERSION_CONFLICT', 'Roster entry has changed', 409, {
            currentVersion: locked.version
          });
        }

        const ownership = await tx.leaguePlayerOwnership.update({
          where: { id: locked.id },
          data: { status: 'RELEASED', version: { increment: 1 } }
        });
        const transaction = await tx.rosterTransaction.create({
          data: {
            leagueId: locked.leagueId,
            seasonId: input.seasonId,
            type: input.amountMinor === null ? 'RELEASE' : 'SELL',
            footballPlayerId: locked.footballPlayerId,
            sourceLeagueTeamId: locked.leagueTeamId,
            oldPlayerCardId: locked.currentPlayerCardId,
            oldSalaryMinor: locked.salaryMinor,
            amountMinor: input.amountMinor,
            reason: input.reason,
            createdByAdminId: adminId,
            createdAt: at
          }
        });
        if (input.amountMinor !== null) {
          await tx.financeLedgerEntry.create({
            data: {
              leagueId: locked.leagueId,
              leagueTeamId: locked.leagueTeamId,
              rosterTransactionId: transaction.id,
              direction: 'CREDIT',
              type: 'PLAYER_SALE',
              amountMinor: input.amountMinor,
              note: input.reason,
              createdAt: at
            }
          });
        }
        await this.audit.record(tx, {
          actorAdminId: adminId,
          leagueId: locked.leagueId,
          action: input.amountMinor === null ? 'ROSTER_PLAYER_RELEASED' : 'ROSTER_PLAYER_SOLD',
          resourceType: 'LEAGUE_PLAYER_OWNERSHIP',
          resourceId: locked.id,
          reason: input.reason,
          metadata: { seasonId: input.seasonId, amountMinor: input.amountMinor }
        });
        const roster = await tx.leaguePlayerOwnership.aggregate({
          where: { leagueTeamId: locked.leagueTeamId, status: 'ACTIVE' },
          _count: { _all: true },
          _sum: { salaryMinor: true }
        });
        const quote = await this.salaryRules.quoteWithClient(
          tx,
          locked.leagueId,
          locked.dtRatingSnapshot,
          at
        );
        await this.setRosterStatus(
          tx,
          locked.leagueTeamId,
          roster._sum.salaryMinor ?? 0,
          quote.salaryCapMinor
        );
        return this.result(ownership, transaction, {
          rosterCount: roster._count._all,
          salaryMinor: roster._sum.salaryMinor ?? 0,
          salaryCapMinor: quote.salaryCapMinor
        });
      }, input);
  }

  async transfer(raw: TransferPlayerRequest, adminId: string, at = new Date()) {
    const input = TransferPlayerRequestSchema.parse(raw);
    const current = await this.loadOwnership(input.ownershipId, input.seasonId);
    await this.loadScope(input.seasonId, input.targetLeagueTeamId);
    await this.authorization.requireLeagueManager(adminId, current.leagueId);
    return this.receipts.execute(adminId, 'ROSTER_PLAYER_TRANSFER', input.idempotencyKey,
      async (tx) => {
        await this.locks.lockTeams(tx, [current.leagueTeamId, input.targetLeagueTeamId]);
        await this.locks.lockOwnership(tx, current.leagueId, current.footballPlayerId);
        await this.loadScopeWithClient(tx, input.seasonId, input.targetLeagueTeamId);
        await this.transferWindows.requireAllowedWithClient(tx, input.seasonId, 'TRANSFER', at);
        const locked = await tx.leaguePlayerOwnership.findUniqueOrThrow({
          where: { id: input.ownershipId }
        });
        this.assertMutableOwnership(locked, input.expectedVersion);
        if (locked.leagueTeamId !== current.leagueTeamId) {
          throw new LeagueRosterError('VERSION_CONFLICT', 'Roster entry team has changed', 409);
        }
        if (locked.leagueTeamId === input.targetLeagueTeamId) {
          throw new LeagueRosterError('ROSTER_TRANSFER_SAME_TEAM', 'Target team must be different', 409);
        }

        const targetRoster = await this.rosterAggregate(tx, input.targetLeagueTeamId);
        if (targetRoster.rosterCount >= MAX_ROSTER_SIZE) {
          throw new LeagueRosterError('TEAM_ROSTER_FULL', 'Target team roster is full', 409, {
            rosterCount: targetRoster.rosterCount,
            rosterLimit: MAX_ROSTER_SIZE
          });
        }
        const quote = await this.salaryRules.quoteWithClient(
          tx,
          locked.leagueId,
          locked.dtRatingSnapshot,
          at
        );
        const projectedSalaryMinor = targetRoster.salaryMinor + quote.salaryMinor;
        if (projectedSalaryMinor > quote.salaryCapMinor) {
          throw this.salaryCapExceeded(
            targetRoster.salaryMinor,
            quote.salaryMinor,
            projectedSalaryMinor,
            quote.salaryCapMinor
          );
        }

        const ownership = await tx.leaguePlayerOwnership.update({
          where: { id: locked.id },
          data: {
            leagueTeamId: input.targetLeagueTeamId,
            salaryRuleVersionId: quote.salaryRuleVersionId,
            salaryMinor: quote.salaryMinor,
            version: { increment: 1 }
          }
        });
        const transaction = await tx.rosterTransaction.create({
          data: {
            leagueId: locked.leagueId,
            seasonId: input.seasonId,
            type: 'TRANSFER',
            footballPlayerId: locked.footballPlayerId,
            sourceLeagueTeamId: locked.leagueTeamId,
            targetLeagueTeamId: input.targetLeagueTeamId,
            oldPlayerCardId: locked.currentPlayerCardId,
            newPlayerCardId: locked.currentPlayerCardId,
            oldSalaryMinor: locked.salaryMinor,
            newSalaryMinor: quote.salaryMinor,
            amountMinor: input.amountMinor,
            reason: input.reason,
            createdByAdminId: adminId,
            createdAt: at
          }
        });
        if (input.amountMinor !== null) {
          await Promise.all([
            tx.financeLedgerEntry.create({
              data: {
                leagueId: locked.leagueId,
                leagueTeamId: locked.leagueTeamId,
                rosterTransactionId: transaction.id,
                direction: 'CREDIT',
                type: 'PLAYER_TRANSFER',
                amountMinor: input.amountMinor,
                note: input.reason,
                createdAt: at
              }
            }),
            tx.financeLedgerEntry.create({
              data: {
                leagueId: locked.leagueId,
                leagueTeamId: input.targetLeagueTeamId,
                rosterTransactionId: transaction.id,
                direction: 'DEBIT',
                type: 'PLAYER_TRANSFER',
                amountMinor: input.amountMinor,
                note: input.reason,
                createdAt: at
              }
            })
          ]);
        }
        await this.audit.record(tx, {
          actorAdminId: adminId,
          leagueId: locked.leagueId,
          action: 'ROSTER_PLAYER_TRANSFERRED',
          resourceType: 'LEAGUE_PLAYER_OWNERSHIP',
          resourceId: locked.id,
          reason: input.reason,
          metadata: {
            seasonId: input.seasonId,
            sourceLeagueTeamId: locked.leagueTeamId,
            targetLeagueTeamId: input.targetLeagueTeamId,
            amountMinor: input.amountMinor
          }
        });
        const sourceRoster = await this.rosterAggregate(tx, locked.leagueTeamId);
        await this.setRosterStatus(
          tx,
          locked.leagueTeamId,
          sourceRoster.salaryMinor,
          quote.salaryCapMinor
        );
        await this.setRosterStatus(
          tx,
          input.targetLeagueTeamId,
          projectedSalaryMinor,
          quote.salaryCapMinor
        );
        return {
          ...this.result(ownership, transaction, {
            rosterCount: targetRoster.rosterCount + 1,
            salaryMinor: projectedSalaryMinor,
            salaryCapMinor: quote.salaryCapMinor
          }),
          sourceSummary: { ...sourceRoster, salaryCapMinor: quote.salaryCapMinor }
        };
      }, input);
  }

  async upgradeCard(raw: UpgradePlayerCardRequest, adminId: string, at = new Date()) {
    const input = UpgradePlayerCardRequestSchema.parse(raw);
    const current = await this.loadOwnership(input.ownershipId, input.seasonId);
    await this.authorization.requireLeagueManager(adminId, current.leagueId);

    return this.receipts.execute(adminId, 'ROSTER_PLAYER_CARD_UPGRADE', input.idempotencyKey,
      async (tx) => {
        await this.locks.lockTeam(tx, current.leagueTeamId);
        await this.locks.lockOwnership(tx, current.leagueId, current.footballPlayerId);
        await this.transferWindows.requireAllowedWithClient(tx, input.seasonId, 'CARD_UPGRADE', at);
        const locked = await tx.leaguePlayerOwnership.findUniqueOrThrow({
          where: { id: input.ownershipId }
        });
        this.assertMutableOwnership(locked, input.expectedVersion);
        if (locked.leagueTeamId !== current.leagueTeamId) {
          throw new LeagueRosterError('VERSION_CONFLICT', 'Roster entry team has changed', 409);
        }
        const build = await this.loadBuild(tx, input.newPlayerCardId);
        if (build.playerCard.playerId !== locked.footballPlayerId) {
          throw new LeagueRosterError(
            'PLAYER_CARD_IDENTITY_MISMATCH',
            'New card belongs to a different football player',
            409
          );
        }
        const quote = await this.salaryRules.quoteWithClient(
          tx,
          locked.leagueId,
          build.dtRating,
          at
        );
        const roster = await this.rosterAggregate(tx, locked.leagueTeamId);
        const projectedSalaryMinor = roster.salaryMinor - locked.salaryMinor + quote.salaryMinor;
        if (projectedSalaryMinor > quote.salaryCapMinor
          && quote.salaryMinor >= locked.salaryMinor) {
          throw this.salaryCapExceeded(
            roster.salaryMinor,
            quote.salaryMinor - locked.salaryMinor,
            projectedSalaryMinor,
            quote.salaryCapMinor
          );
        }
        const ownership = await tx.leaguePlayerOwnership.update({
          where: { id: locked.id },
          data: {
            currentPlayerCardId: input.newPlayerCardId,
            dtRatingSnapshot: build.dtRating,
            salaryRuleVersionId: quote.salaryRuleVersionId,
            salaryMinor: quote.salaryMinor,
            version: { increment: 1 }
          }
        });
        const transaction = await tx.rosterTransaction.create({
          data: {
            leagueId: locked.leagueId,
            seasonId: input.seasonId,
            type: 'CARD_UPGRADE',
            footballPlayerId: locked.footballPlayerId,
            sourceLeagueTeamId: locked.leagueTeamId,
            targetLeagueTeamId: locked.leagueTeamId,
            oldPlayerCardId: locked.currentPlayerCardId,
            newPlayerCardId: input.newPlayerCardId,
            oldSalaryMinor: locked.salaryMinor,
            newSalaryMinor: quote.salaryMinor,
            amountMinor: input.amountMinor,
            reason: input.reason,
            createdByAdminId: adminId,
            createdAt: at
          }
        });
        if (input.amountMinor !== null) {
          await tx.financeLedgerEntry.create({
            data: {
              leagueId: locked.leagueId,
              leagueTeamId: locked.leagueTeamId,
              rosterTransactionId: transaction.id,
              direction: 'DEBIT',
              type: 'CARD_UPGRADE',
              amountMinor: input.amountMinor,
              note: input.reason,
              createdAt: at
            }
          });
        }
        await this.audit.record(tx, {
          actorAdminId: adminId,
          leagueId: locked.leagueId,
          action: 'ROSTER_PLAYER_CARD_UPGRADED',
          resourceType: 'LEAGUE_PLAYER_OWNERSHIP',
          resourceId: locked.id,
          reason: input.reason,
          metadata: {
            oldPlayerCardId: locked.currentPlayerCardId,
            newPlayerCardId: input.newPlayerCardId,
            oldSalaryMinor: locked.salaryMinor,
            newSalaryMinor: quote.salaryMinor
          }
        });
        await this.setRosterStatus(
          tx,
          locked.leagueTeamId,
          projectedSalaryMinor,
          quote.salaryCapMinor
        );
        return this.result(ownership, transaction, {
          rosterCount: roster.rosterCount,
          salaryMinor: projectedSalaryMinor,
          salaryCapMinor: quote.salaryCapMinor
        });
      }, input);
  }

  async emergencyCorrect(raw: EmergencyCorrectRosterRequest, adminId: string, at = new Date()) {
    const input = EmergencyCorrectRosterRequestSchema.parse(raw);
    const current = await this.loadOwnership(input.ownershipId, input.seasonId);
    await this.authorization.requirePlatformAdmin(adminId);
    const targetTeamId = input.targetLeagueTeamId ?? current.leagueTeamId;
    if (targetTeamId !== current.leagueTeamId) {
      await this.loadScope(input.seasonId, targetTeamId);
    }

    return this.receipts.execute(adminId, 'ROSTER_EMERGENCY_CORRECTION', input.idempotencyKey,
      async (tx) => {
        await this.locks.lockTeams(tx, [current.leagueTeamId, targetTeamId]);
        await this.locks.lockOwnership(tx, current.leagueId, current.footballPlayerId);
        if (targetTeamId !== current.leagueTeamId) {
          await this.loadScopeWithClient(tx, input.seasonId, targetTeamId);
        }
        const locked = await tx.leaguePlayerOwnership.findUniqueOrThrow({
          where: { id: input.ownershipId }
        });
        this.assertMutableOwnership(locked, input.expectedVersion);
        if (locked.leagueTeamId !== current.leagueTeamId) {
          throw new LeagueRosterError('VERSION_CONFLICT', 'Roster entry team has changed', 409);
        }
        const newCardId = input.newPlayerCardId ?? locked.currentPlayerCardId;
        const build = await this.loadBuild(tx, newCardId);
        if (build.playerCard.playerId !== locked.footballPlayerId) {
          throw new LeagueRosterError(
            'PLAYER_CARD_IDENTITY_MISMATCH',
            'Correction card belongs to a different football player',
            409
          );
        }
        const quote = await this.salaryRules.quoteWithClient(
          tx,
          locked.leagueId,
          build.dtRating,
          at
        );
        const targetRoster = await this.rosterAggregate(tx, targetTeamId);
        const movingTeams = targetTeamId !== locked.leagueTeamId;
        if (movingTeams && targetRoster.rosterCount >= MAX_ROSTER_SIZE) {
          throw new LeagueRosterError('TEAM_ROSTER_FULL', 'Target team roster is full', 409);
        }
        const projectedSalaryMinor = targetRoster.salaryMinor
          - (movingTeams ? 0 : locked.salaryMinor)
          + quote.salaryMinor;
        if (quote.salaryMinor > (movingTeams ? 0 : locked.salaryMinor)
          && projectedSalaryMinor > quote.salaryCapMinor) {
          throw this.salaryCapExceeded(
            targetRoster.salaryMinor,
            quote.salaryMinor,
            projectedSalaryMinor,
            quote.salaryCapMinor
          );
        }
        const ownership = await tx.leaguePlayerOwnership.update({
          where: { id: locked.id },
          data: {
            leagueTeamId: targetTeamId,
            currentPlayerCardId: newCardId,
            dtRatingSnapshot: build.dtRating,
            salaryRuleVersionId: quote.salaryRuleVersionId,
            salaryMinor: quote.salaryMinor,
            version: { increment: 1 }
          }
        });
        const transaction = await tx.rosterTransaction.create({
          data: {
            leagueId: locked.leagueId,
            seasonId: input.seasonId,
            type: 'EMERGENCY_CORRECTION',
            footballPlayerId: locked.footballPlayerId,
            sourceLeagueTeamId: locked.leagueTeamId,
            targetLeagueTeamId: targetTeamId,
            oldPlayerCardId: locked.currentPlayerCardId,
            newPlayerCardId: newCardId,
            oldSalaryMinor: locked.salaryMinor,
            newSalaryMinor: quote.salaryMinor,
            reason: input.reason,
            createdByAdminId: adminId,
            createdAt: at
          }
        });
        await this.audit.record(tx, {
          actorAdminId: adminId,
          leagueId: locked.leagueId,
          action: 'ROSTER_EMERGENCY_CORRECTED',
          resourceType: 'LEAGUE_PLAYER_OWNERSHIP',
          resourceId: locked.id,
          reason: input.reason,
          metadata: { targetTeamId, newCardId }
        });
        if (movingTeams) {
          const sourceRoster = await this.rosterAggregate(tx, locked.leagueTeamId);
          await this.setRosterStatus(
            tx,
            locked.leagueTeamId,
            sourceRoster.salaryMinor,
            quote.salaryCapMinor
          );
        }
        await this.setRosterStatus(
          tx,
          targetTeamId,
          projectedSalaryMinor,
          quote.salaryCapMinor
        );
        return this.result(ownership, transaction, {
          rosterCount: targetRoster.rosterCount + (movingTeams ? 1 : 0),
          salaryMinor: projectedSalaryMinor,
          salaryCapMinor: quote.salaryCapMinor
        });
      }, input);
  }

  private async loadScope(seasonId: string, leagueTeamId: string) {
    return this.loadScopeWithClient(this.prisma, seasonId, leagueTeamId);
  }

  private async loadOwnership(ownershipId: string, seasonId: string) {
    const [ownership, season] = await Promise.all([
      this.prisma.leaguePlayerOwnership.findUnique({ where: { id: ownershipId } }),
      this.prisma.leagueSeason.findUnique({ where: { id: seasonId } })
    ]);
    if (!ownership) {
      throw new LeagueRosterError('ROSTER_ENTRY_NOT_FOUND', 'Roster entry was not found', 404);
    }
    if (!season || season.leagueId !== ownership.leagueId) {
      throw new LeagueRosterError('ROSTER_SCOPE_MISMATCH', 'Season and roster entry differ', 409);
    }
    return ownership;
  }

  private async loadBuild(client: Prisma.TransactionClient, playerCardId: string) {
    const build = await client.playerCardAutoBuild.findFirst({
      where: { playerCardId },
      orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
      include: { playerCard: true }
    });
    if (!build) {
      throw new LeagueRosterError(
        'PLAYER_AUTO_BUILD_MISSING',
        'The selected player card has no automatic build',
        422
      );
    }
    if (build.dtRating === null) {
      throw new LeagueRosterError(
        'PLAYER_DT_RATING_MISSING',
        'The selected player card has no DT rating',
        422
      );
    }
    return { ...build, dtRating: build.dtRating };
  }

  private async rosterAggregate(client: Prisma.TransactionClient, leagueTeamId: string) {
    const aggregate = await client.leaguePlayerOwnership.aggregate({
      where: { leagueTeamId, status: 'ACTIVE' },
      _count: { _all: true },
      _sum: { salaryMinor: true }
    });
    return {
      rosterCount: aggregate._count._all,
      salaryMinor: aggregate._sum.salaryMinor ?? 0
    };
  }

  private assertMutableOwnership(
    ownership: { status: string; version: number },
    expectedVersion: number
  ) {
    if (ownership.status !== 'ACTIVE') {
      throw new LeagueRosterError('ROSTER_ENTRY_NOT_ACTIVE', 'Roster entry is not active', 409);
    }
    if (ownership.version !== expectedVersion) {
      throw new LeagueRosterError('VERSION_CONFLICT', 'Roster entry has changed', 409, {
        currentVersion: ownership.version
      });
    }
  }

  private async setRosterStatus(
    client: Prisma.TransactionClient,
    leagueTeamId: string,
    salaryMinor: number,
    salaryCapMinor: number
  ) {
    const rosterStatus = salaryMinor > salaryCapMinor ? 'OVER_CAP' : 'COMPLIANT';
    await client.leagueTeam.updateMany({
      where: { id: leagueTeamId, rosterStatus: { not: rosterStatus } },
      data: { rosterStatus, version: { increment: 1 } }
    });
  }

  private salaryCapExceeded(
    currentSalaryMinor: number,
    playerSalaryMinor: number,
    projectedSalaryMinor: number,
    salaryCapMinor: number
  ) {
    return new LeagueRosterError(
      'TEAM_SALARY_CAP_EXCEEDED',
      'The operation would exceed the team salary cap',
      409,
      { currentSalaryMinor, playerSalaryMinor, projectedSalaryMinor, salaryCapMinor }
    );
  }

  private async loadScopeWithClient(
    client: PrismaService | Prisma.TransactionClient,
    seasonId: string,
    leagueTeamId: string
  ) {
    const [season, team] = await Promise.all([
      client.leagueSeason.findUnique({ where: { id: seasonId } }),
      client.leagueTeam.findUnique({ where: { id: leagueTeamId } })
    ]);
    if (!season || !team) {
      throw new LeagueRosterError('ROSTER_SCOPE_NOT_FOUND', 'Season or league team was not found', 404);
    }
    if (season.leagueId !== team.leagueId) {
      throw new LeagueRosterError('ROSTER_SCOPE_MISMATCH', 'Season and league team differ', 409);
    }
    if (team.status !== 'ACTIVE' || team.teamNumber === null) {
      throw new LeagueRosterError(
        'LEAGUE_TEAM_NOT_ELIGIBLE',
        'Only active, numbered league teams may change their roster',
        409,
        { teamStatus: team.status, teamNumber: team.teamNumber }
      );
    }
    return { leagueId: team.leagueId };
  }

  private playerAlreadyOwned(leagueTeamId?: string) {
    return new LeagueRosterError(
      'LEAGUE_PLAYER_ALREADY_OWNED',
      'This football player already belongs to a team in the league',
      409,
      leagueTeamId ? { leagueTeamId } : {}
    );
  }

  private result(
    ownership: {
      id: string;
      leagueId: string;
      leagueTeamId: string;
      footballPlayerId: string;
      currentPlayerCardId: string;
      dtRatingSnapshot: number;
      salaryRuleVersionId: string;
      salaryMinor: number;
      acquiredAt: Date;
      status: RosterMutationOwnership['status'];
      version: number;
    },
    transaction: {
      id: string;
      leagueId: string;
      seasonId: string;
      type: 'BUY' | 'SELL' | 'RELEASE' | 'TRANSFER' | 'CARD_UPGRADE'
        | 'SALARY_RECALCULATION' | 'EMERGENCY_CORRECTION';
      footballPlayerId: string;
      sourceLeagueTeamId: string | null;
      targetLeagueTeamId: string | null;
      oldPlayerCardId: string | null;
      newPlayerCardId: string | null;
      oldSalaryMinor: number | null;
      newSalaryMinor: number | null;
      amountMinor: number | null;
      reason: string;
      createdByAdminId: string;
      createdAt: Date;
    },
    summary: { rosterCount: number; salaryMinor: number; salaryCapMinor: number }
  ): RosterMutationResponse {
    return {
      ownership: {
        id: ownership.id,
        leagueId: ownership.leagueId,
        leagueTeamId: ownership.leagueTeamId,
        playerId: ownership.footballPlayerId,
        currentPlayerCardId: ownership.currentPlayerCardId,
        dtRating: ownership.dtRatingSnapshot,
        salaryRuleVersionId: ownership.salaryRuleVersionId,
        salaryMinor: ownership.salaryMinor,
        acquiredAt: ownership.acquiredAt.toISOString(),
        status: ownership.status,
        version: ownership.version
      },
      transaction: {
        id: transaction.id,
        leagueId: transaction.leagueId,
        seasonId: transaction.seasonId,
        type: transaction.type,
        playerId: transaction.footballPlayerId,
        sourceLeagueTeamId: transaction.sourceLeagueTeamId,
        targetLeagueTeamId: transaction.targetLeagueTeamId,
        oldPlayerCardId: transaction.oldPlayerCardId,
        newPlayerCardId: transaction.newPlayerCardId,
        oldSalaryMinor: transaction.oldSalaryMinor,
        newSalaryMinor: transaction.newSalaryMinor,
        amountMinor: transaction.amountMinor,
        reason: transaction.reason,
        createdByAdminId: transaction.createdByAdminId,
        createdAt: transaction.createdAt.toISOString()
      },
      summary
    };
  }
}
