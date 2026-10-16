import { Inject, Injectable } from '@nestjs/common';
import type { ReleaseOwnedPlayerRequest, RosterMutationResponse } from '@efm/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { MutationReceiptService } from '../competitions/mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PlayerMarketAccessService } from './player-market-access.service.js';
import { PlayerMarketLockRepository } from './player-market-lock.repository.js';
import { playerMarketError } from './player-market.errors.js';
import { ValuationSnapshotsService } from '../player-valuations/valuation-snapshots.service.js';

@Injectable()
export class TeamPlayerReleaseService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MutationReceiptService) private readonly receipts: MutationReceiptService,
    @Inject(PlayerMarketAccessService) private readonly access: PlayerMarketAccessService,
    @Inject(PlayerMarketLockRepository) private readonly locks: PlayerMarketLockRepository,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(ValuationSnapshotsService) private readonly valuationSnapshots: ValuationSnapshotsService
  ) {}

  async release(
    userId: string,
    leagueTeamId: string,
    input: ReleaseOwnedPlayerRequest,
    key: string,
    at = new Date()
  ): Promise<RosterMutationResponse> {
    const scope = await this.access.requireOwnedTeam(userId, leagueTeamId, input.seasonId);
    return this.receipts.execute(userId, `player-market.release:${input.ownershipId}`, key, async (tx) => {
      const snapshot = await tx.leaguePlayerOwnership.findUnique({ where: { id: input.ownershipId } });
      if (!snapshot || snapshot.leagueId !== scope.leagueId || snapshot.leagueTeamId !== leagueTeamId) {
        throw playerMarketError('OWNERSHIP_NOT_FOUND', '球队中不存在该球员', 404);
      }
      await this.valuationSnapshots.synchronizeSeasonBeforeRosterMutation(tx, input.seasonId, () => at);
      await this.locks.lockPlayer(tx, snapshot.leagueId, snapshot.footballPlayerId);
      await this.locks.lockTeams(tx, [leagueTeamId]);
      const current = await tx.leaguePlayerOwnership.findUnique({ where: { id: input.ownershipId } });
      if (!current || current.leagueId !== scope.leagueId || current.leagueTeamId !== leagueTeamId) {
        throw playerMarketError('OWNERSHIP_NOT_FOUND', '球队中不存在该球员', 404);
      }
      const [team, window] = await Promise.all([
        tx.leagueTeam.findUnique({ where: { id: leagueTeamId } }),
        tx.transferWindow.findUnique({ where: { id: input.transferWindowId } })
      ]);
      if (!team || team.status !== 'ACTIVE') throw playerMarketError('LEAGUE_TEAM_INELIGIBLE', '球队已退出或不可用');
      if (!window || window.seasonId !== input.seasonId || !window.allowSell || at < window.startsAt || at >= window.endsAt) {
        throw playerMarketError('TRANSFER_WINDOW_CLOSED', '当前窗口不允许下放球员');
      }
      if (current.version !== input.expectedVersion) throw playerMarketError('VERSION_CONFLICT', '球员归属已更新，请刷新后重试');
      if (current.status !== 'ACTIVE') throw playerMarketError('OWNERSHIP_NOT_ACTIVE', '该球员已不在现役阵容');

      const ownership = await tx.leaguePlayerOwnership.update({
        where: { id: current.id },
        data: { status: 'RELEASED', version: { increment: 1 } }
      });
      const transaction = await tx.rosterTransaction.create({ data: {
        leagueId: current.leagueId,
        seasonId: input.seasonId,
        type: 'RELEASE',
        footballPlayerId: current.footballPlayerId,
        sourceLeagueTeamId: leagueTeamId,
        oldPlayerCardId: current.currentPlayerCardId,
        oldSalaryMinor: current.salaryMinor,
        reason: input.reason,
        createdByUserId: userId,
        createdAt: at
      } });
      await tx.playerReleaseRestriction.create({ data: {
        leagueId: current.leagueId,
        seasonId: input.seasonId,
        transferWindowId: input.transferWindowId,
        leagueTeamId,
        footballPlayerId: current.footballPlayerId,
        rosterTransactionId: transaction.id,
        createdByUserId: userId,
        createdAt: at
      } });
      await this.audit.record(tx, {
        actorUserId: userId,
        leagueId: current.leagueId,
        action: 'TEAM_PLAYER_RELEASED',
        resourceType: 'LEAGUE_PLAYER_OWNERSHIP',
        resourceId: current.id,
        reason: input.reason,
        metadata: { seasonId: input.seasonId, leagueTeamId, footballPlayerId: current.footballPlayerId }
      });
      const [rosterCount, salary, rule] = await Promise.all([
        tx.leaguePlayerOwnership.count({ where: { leagueTeamId, status: 'ACTIVE' } }),
        tx.leaguePlayerOwnership.aggregate({ where: { leagueTeamId, status: 'ACTIVE' }, _sum: { salaryMinor: true } }),
        tx.leagueSalaryRuleVersion.findFirst({
          where: { leagueId: current.leagueId, status: 'ACTIVE', effectiveAt: { lte: at } },
          orderBy: [{ effectiveAt: 'desc' }, { version: 'desc' }]
        })
      ]);
      if (!rule) throw playerMarketError('SALARY_RULE_NOT_CONFIGURED', '联赛尚未配置工资规则', 422);
      const salaryMinor = salary._sum.salaryMinor ?? 0;
      const rosterStatus = salaryMinor > rule.salaryCapMinor ? 'OVER_CAP' : 'COMPLIANT';
      await tx.leagueTeam.updateMany({
        where: { id: leagueTeamId, rosterStatus: { not: rosterStatus } },
        data: { rosterStatus, version: { increment: 1 } }
      });
      return {
        ownership: {
          id: ownership.id,
          leagueId: ownership.leagueId,
          leagueTeamId: ownership.leagueTeamId,
          playerId: ownership.footballPlayerId,
          currentPlayerCardId: ownership.currentPlayerCardId,
          maxOverall: ownership.maxOverallSnapshot,
          salaryRuleVersionId: ownership.salaryRuleVersionId,
          salaryMinor: ownership.salaryMinor,
          acquiredAt: ownership.acquiredAt.toISOString(),
          acquisitionType: ownership.acquisitionType,
          acquisitionSeasonId: ownership.acquisitionSeasonId,
          forcedTransferBadge: ownership.acquisitionType === 'FORCED_TRANSFER' && ownership.acquisitionSeasonId === input.seasonId,
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
          valuationSnapshotMinor: transaction.valuationSnapshotMinor,
          transactionFeeMinor: transaction.transactionFeeMinor,
          transactionFeeRuleVersionId: transaction.transactionFeeRuleVersionId,
          reason: transaction.reason,
          createdByAdminId: transaction.createdByAdminId,
          createdByUserId: transaction.createdByUserId,
          createdAt: transaction.createdAt.toISOString()
        },
        summary: { rosterCount, salaryMinor, salaryCapMinor: rule.salaryCapMinor }
      };
    });
  }
}
