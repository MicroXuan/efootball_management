import { Inject, Injectable } from '@nestjs/common';
import type { ReviewPlayerApplicationRequest } from '@efm/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { RosterLockRepository } from '../league-rosters/roster-lock.repository.js';
import { SalaryRulesService } from '../league-rosters/salary-rules.service.js';
import { PlayerMarketLockRepository } from './player-market-lock.repository.js';
import { playerMarketError } from './player-market.errors.js';
import { sortForcedQueue } from './forced-transfer-policy.js';

export type PlayerMarketReviewResult = {
  applicationId: string;
  status: 'APPROVED' | 'REJECTED' | 'REQUOTE_REQUIRED' | 'OWNERSHIP_CHANGED' | 'INELIGIBLE';
  transactionId: string | null;
  transactionType: 'BUY' | 'FORCED_TRANSFER' | null;
  ownershipId: string | null;
};

@Injectable()
export class PlayerMarketReviewService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminMutationReceiptService) private readonly receipts: AdminMutationReceiptService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(PlayerMarketLockRepository) private readonly marketLocks: PlayerMarketLockRepository,
    @Inject(RosterLockRepository) private readonly rosterLocks: RosterLockRepository,
    @Inject(SalaryRulesService) private readonly salaryRules: SalaryRulesService,
    @Inject(AuditLogService) private readonly audit: AuditLogService
  ) {}

  approve(
    adminId: string,
    applicationId: string,
    input: ReviewPlayerApplicationRequest,
    key: string,
    at = new Date()
  ): Promise<PlayerMarketReviewResult> {
    return this.receipts.execute(adminId, `player-market.approve:${applicationId}`, key, async (tx) => {
      await this.marketLocks.lockApplication(tx, applicationId);
      const application = await tx.playerAcquisitionApplication.findUnique({
        where: { id: applicationId },
        include: { playerCard: { include: { autoBuilds: { orderBy: { calculatedAt: 'desc' }, take: 1 } } } }
      });
      if (!application) throw playerMarketError('PLAYER_APPLICATION_NOT_FOUND', '申请不存在', 404);
      await this.authorization.requireLeagueManager(adminId, application.leagueId);
      this.assertVersion(application.version, input.expectedVersion);
      if (application.status !== 'PENDING') throw playerMarketError('APPLICATION_STATE_INVALID', '当前申请不能通过');

      await this.marketLocks.lockPlayer(tx, application.leagueId, application.footballPlayerId);
      const teamIds = [application.applicantLeagueTeamId, application.sourceLeagueTeamId].filter((id): id is string => Boolean(id));
      await this.rosterLocks.lockTeams(tx, teamIds);
      const [window, buyer, rosterCount, valuation, ownership] = await Promise.all([
        tx.transferWindow.findUnique({ where: { id: application.transferWindowId } }),
        tx.leagueTeam.findUnique({ where: { id: application.applicantLeagueTeamId } }),
        tx.leaguePlayerOwnership.count({ where: { leagueTeamId: application.applicantLeagueTeamId, status: 'ACTIVE' } }),
        tx.leaguePlayerValuation.findUnique({ where: { leagueId_footballPlayerId: { leagueId: application.leagueId, footballPlayerId: application.footballPlayerId } } }),
        tx.leaguePlayerOwnership.findUnique({ where: { leagueId_footballPlayerId: { leagueId: application.leagueId, footballPlayerId: application.footballPlayerId } } })
      ]);
      if (!window || window.seasonId !== application.seasonId || !window.allowBuy || at < window.startsAt || at >= window.endsAt) {
        return this.mark(tx, application, adminId, 'INELIGIBLE', input.reason, 'TRANSFER_WINDOW_CLOSED');
      }
      if (!buyer || buyer.status !== 'ACTIVE' || buyer.rosterStatus !== 'COMPLIANT' || rosterCount >= 25) {
        return this.mark(tx, application, adminId, 'INELIGIBLE', input.reason, rosterCount >= 25 ? 'ROSTER_CAPACITY_REACHED' : 'TEAM_INELIGIBLE');
      }

      if (application.type === 'FORCED_TRANSFER') {
        if (!ownership || ownership.status !== 'ACTIVE' || ownership.id !== application.ownershipId
          || ownership.version !== application.ownershipVersionSnapshot
          || ownership.leagueTeamId !== application.sourceLeagueTeamId) {
          return this.mark(tx, application, adminId, 'OWNERSHIP_CHANGED', input.reason, 'OWNERSHIP_CHANGED');
        }
        if (!valuation || application.amountMinor < valuation.currentValueMinor) {
          return this.mark(tx, application, adminId, 'REQUOTE_REQUIRED', input.reason, 'OFFICIAL_VALUE_INCREASED');
        }
        const queue = await tx.playerAcquisitionApplication.findMany({
          where: {
            leagueId: application.leagueId,
            seasonId: application.seasonId,
            footballPlayerId: application.footballPlayerId,
            type: 'FORCED_TRANSFER',
            ownershipId: application.ownershipId,
            ownershipVersionSnapshot: application.ownershipVersionSnapshot,
            status: 'PENDING'
          },
          select: { id: true, firstValidSubmittedAt: true }
        });
        if (sortForcedQueue(queue)[0]?.id !== application.id) {
          throw playerMarketError('FORCED_QUEUE_ORDER_VIOLATION', '只能审核当前强报队列首位');
        }
        return this.settleForced(tx, adminId, application, ownership, input.reason, at);
      }

      if (ownership?.status === 'ACTIVE') {
        return this.mark(tx, application, adminId, 'OWNERSHIP_CHANGED', input.reason, 'PLAYER_ALREADY_OWNED');
      }
      const build = application.playerCard.autoBuilds[0];
      if (!build) return this.mark(tx, application, adminId, 'INELIGIBLE', input.reason, 'PLAYER_BUILD_REQUIRED');
      const quote = await this.salaryRules.quoteWithClient(tx, application.leagueId, build.maxOverall, at);
      const salary = await tx.leaguePlayerOwnership.aggregate({
        where: { leagueTeamId: application.applicantLeagueTeamId, status: 'ACTIVE' },
        _sum: { salaryMinor: true }
      });
      if ((salary._sum.salaryMinor ?? 0) + quote.salaryMinor > quote.salaryCapMinor) {
        return this.mark(tx, application, adminId, 'INELIGIBLE', input.reason, 'SALARY_CAP_EXCEEDED');
      }
      const settledOwnership = await tx.leaguePlayerOwnership.create({
        data: {
          leagueId: application.leagueId,
          leagueTeamId: application.applicantLeagueTeamId,
          footballPlayerId: application.footballPlayerId,
          currentPlayerCardId: application.playerCardId,
          maxOverallSnapshot: build.maxOverall,
          dtRatingSnapshot: build.dtRating,
          salaryRuleVersionId: quote.salaryRuleVersionId,
          salaryMinor: quote.salaryMinor,
          acquisitionType: 'NORMAL',
          acquisitionSeasonId: application.seasonId,
          acquiredAt: at
        }
      });
      const transaction = await tx.rosterTransaction.create({
        data: {
          leagueId: application.leagueId,
          seasonId: application.seasonId,
          type: 'BUY',
          footballPlayerId: application.footballPlayerId,
          targetLeagueTeamId: application.applicantLeagueTeamId,
          newPlayerCardId: application.playerCardId,
          newSalaryMinor: quote.salaryMinor,
          amountMinor: application.amountMinor,
          valuationSnapshotMinor: valuation?.currentValueMinor ?? null,
          playerApplicationId: application.id,
          reason: input.reason,
          createdByAdminId: adminId,
          createdAt: at
        }
      });
      await tx.financeLedgerEntry.create({ data: {
        leagueId: application.leagueId,
        leagueTeamId: application.applicantLeagueTeamId,
        seasonId: application.seasonId,
        rosterTransactionId: transaction.id,
        direction: 'DEBIT',
        type: 'PLAYER_PURCHASE',
        amountMinor: application.amountMinor,
        note: input.reason,
        createdAt: at
      } });
      await this.approveApplication(tx, application, adminId, input.reason, at);
      await tx.playerAcquisitionApplication.updateMany({
        where: {
          id: { not: application.id },
          leagueId: application.leagueId,
          seasonId: application.seasonId,
          footballPlayerId: application.footballPlayerId,
          type: 'NORMAL_PURCHASE',
          status: { in: ['PENDING', 'REQUOTE_REQUIRED'] }
        },
        data: { status: 'NOT_SELECTED', reviewReason: '其他申请已获批准', reviewedAt: at, version: { increment: 1 } }
      });
      await this.recordAudit(tx, adminId, application, settledOwnership.id, transaction.id, input.reason);
      return { applicationId, status: 'APPROVED', transactionId: transaction.id, transactionType: 'BUY', ownershipId: settledOwnership.id };
    }, input);
  }

  reject(adminId: string, applicationId: string, input: ReviewPlayerApplicationRequest, key: string): Promise<PlayerMarketReviewResult> {
    return this.receipts.execute(adminId, `player-market.reject:${applicationId}`, key, async (tx) => {
      await this.marketLocks.lockApplication(tx, applicationId);
      const application = await tx.playerAcquisitionApplication.findUnique({ where: { id: applicationId } });
      if (!application) throw playerMarketError('PLAYER_APPLICATION_NOT_FOUND', '申请不存在', 404);
      await this.authorization.requireLeagueManager(adminId, application.leagueId);
      this.assertVersion(application.version, input.expectedVersion);
      if (!['PENDING', 'REQUOTE_REQUIRED'].includes(application.status)) {
        throw playerMarketError('APPLICATION_STATE_INVALID', '当前申请不能驳回');
      }
      await tx.playerAcquisitionApplication.update({
        where: { id: application.id },
        data: { status: 'REJECTED', reviewedByAdminId: adminId, reviewedAt: new Date(), reviewReason: input.reason, version: { increment: 1 } }
      });
      await this.event(tx, application.id, 'REJECTED', application.status, 'REJECTED', application.amountMinor, adminId, input.reason);
      await this.recordAudit(tx, adminId, application, null, null, input.reason);
      return { applicationId, status: 'REJECTED', transactionId: null, transactionType: null, ownershipId: null };
    }, input);
  }

  private async settleForced(
    tx: Prisma.TransactionClient,
    adminId: string,
    application: Prisma.PlayerAcquisitionApplicationGetPayload<{ include: { playerCard: { include: { autoBuilds: true } } } }>,
    ownership: NonNullable<Awaited<ReturnType<Prisma.TransactionClient['leaguePlayerOwnership']['findUnique']>>>,
    reason: string,
    at: Date
  ): Promise<PlayerMarketReviewResult> {
    const sourceTeamId = ownership.leagueTeamId;
    const updated = await tx.leaguePlayerOwnership.update({
      where: { id: ownership.id },
      data: {
        leagueTeamId: application.applicantLeagueTeamId,
        currentPlayerCardId: ownership.currentPlayerCardId,
        maxOverallSnapshot: ownership.maxOverallSnapshot,
        dtRatingSnapshot: ownership.dtRatingSnapshot,
        salaryRuleVersionId: ownership.salaryRuleVersionId,
        salaryMinor: ownership.salaryMinor,
        acquisitionType: 'FORCED_TRANSFER',
        acquisitionSeasonId: application.seasonId,
        acquiredAt: at,
        version: { increment: 1 }
      }
    });
    const transaction = await tx.rosterTransaction.create({ data: {
      leagueId: application.leagueId,
      seasonId: application.seasonId,
      type: 'FORCED_TRANSFER',
      footballPlayerId: application.footballPlayerId,
      sourceLeagueTeamId: sourceTeamId,
      targetLeagueTeamId: application.applicantLeagueTeamId,
      oldPlayerCardId: ownership.currentPlayerCardId,
      newPlayerCardId: ownership.currentPlayerCardId,
      oldSalaryMinor: ownership.salaryMinor,
      newSalaryMinor: ownership.salaryMinor,
      amountMinor: application.amountMinor,
      valuationSnapshotMinor: application.valuationMinorSnapshot,
      playerApplicationId: application.id,
      reason,
      createdByAdminId: adminId,
      createdAt: at
    } });
    await Promise.all([
      tx.financeLedgerEntry.create({ data: {
        leagueId: application.leagueId, leagueTeamId: application.applicantLeagueTeamId,
        seasonId: application.seasonId, rosterTransactionId: transaction.id,
        direction: 'DEBIT', type: 'PLAYER_TRANSFER', amountMinor: application.amountMinor, note: reason, createdAt: at
      } }),
      tx.financeLedgerEntry.create({ data: {
        leagueId: application.leagueId, leagueTeamId: sourceTeamId,
        seasonId: application.seasonId, rosterTransactionId: transaction.id,
        direction: 'CREDIT', type: 'PLAYER_TRANSFER', amountMinor: application.amountMinor, note: reason, createdAt: at
      } })
    ]);
    await this.approveApplication(tx, application, adminId, reason, at);
    await tx.playerAcquisitionApplication.updateMany({
      where: {
        id: { not: application.id },
        leagueId: application.leagueId,
        footballPlayerId: application.footballPlayerId,
        ownershipId: application.ownershipId,
        ownershipVersionSnapshot: application.ownershipVersionSnapshot,
        status: { in: ['PENDING', 'REQUOTE_REQUIRED'] }
      },
      data: { status: 'OWNERSHIP_CHANGED', reviewReason: '原归属已发生变化', reviewedAt: at, version: { increment: 1 } }
    });
    await this.recordAudit(tx, adminId, application, updated.id, transaction.id, reason);
    return { applicationId: application.id, status: 'APPROVED', transactionId: transaction.id, transactionType: 'FORCED_TRANSFER', ownershipId: updated.id };
  }

  private async approveApplication(tx: Prisma.TransactionClient, application: { id: string; status: string; amountMinor: number }, adminId: string, reason: string, at: Date): Promise<void> {
    await tx.playerAcquisitionApplication.update({
      where: { id: application.id },
      data: { status: 'APPROVED', reviewedByAdminId: adminId, reviewedAt: at, reviewReason: reason, version: { increment: 1 } }
    });
    await this.event(tx, application.id, 'APPROVED', application.status, 'APPROVED', application.amountMinor, adminId, reason);
  }

  private async mark(
    tx: Prisma.TransactionClient,
    application: { id: string; status: string; amountMinor: number },
    adminId: string,
    status: 'REQUOTE_REQUIRED' | 'OWNERSHIP_CHANGED' | 'INELIGIBLE',
    reviewReason: string,
    reason: string
  ): Promise<PlayerMarketReviewResult> {
    await tx.playerAcquisitionApplication.update({
      where: { id: application.id },
      data: { status, reviewReason: reason, version: { increment: 1 } }
    });
    await this.event(tx, application.id, status, application.status, status, application.amountMinor, adminId, reviewReason);
    return { applicationId: application.id, status, transactionId: null, transactionType: null, ownershipId: null };
  }

  private event(tx: Prisma.TransactionClient, applicationId: string, type: 'APPROVED' | 'REJECTED' | 'REQUOTE_REQUIRED' | 'OWNERSHIP_CHANGED' | 'INELIGIBLE', fromStatus: string, toStatus: 'APPROVED' | 'REJECTED' | 'REQUOTE_REQUIRED' | 'OWNERSHIP_CHANGED' | 'INELIGIBLE', amountMinor: number, actorAdminId: string, reason: string) {
    return tx.playerAcquisitionApplicationEvent.create({ data: {
      applicationId, type, fromStatus: fromStatus as 'PENDING' | 'REQUOTE_REQUIRED', toStatus,
      fromAmountMinor: amountMinor, toAmountMinor: amountMinor, actorAdminId, reason
    } });
  }

  private recordAudit(tx: Prisma.TransactionClient, adminId: string, application: { id: string; leagueId: string; seasonId: string; type: string }, ownershipId: string | null, transactionId: string | null, reason: string) {
    return this.audit.record(tx, {
      actorAdminId: adminId,
      leagueId: application.leagueId,
      action: 'PLAYER_APPLICATION_REVIEWED',
      resourceType: 'PLAYER_ACQUISITION_APPLICATION',
      resourceId: application.id,
      reason,
      metadata: { seasonId: application.seasonId, type: application.type, ownershipId, transactionId }
    });
  }

  private assertVersion(actual: number, expected: number): void {
    if (actual !== expected) throw playerMarketError('VERSION_CONFLICT', '申请已被其他操作更新，请刷新后重试');
  }
}
