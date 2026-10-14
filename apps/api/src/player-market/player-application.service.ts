import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  AmendPlayerApplicationRequest,
  PlayerAcquisitionApplication,
  PlayerApplicationEventType,
  SubmitPlayerApplicationRequest,
  WithdrawPlayerApplicationRequest
} from '@efm/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { MutationReceiptService } from '../competitions/mutation-receipt.service.js';
import { PlayerMarketAccessService } from './player-market-access.service.js';
import { playerMarketError } from './player-market.errors.js';
import { PlayerMarketLockRepository } from './player-market-lock.repository.js';

const applicationInclude = {
  applicantLeagueTeam: true,
  sourceLeagueTeam: true,
  footballPlayer: true,
  playerCard: { include: { autoBuilds: { orderBy: { calculatedAt: 'desc' as const }, take: 1 } } },
  events: { include: { actorUser: true, actorAdmin: true }, orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }] }
} satisfies Prisma.PlayerAcquisitionApplicationInclude;

type ApplicationRow = Prisma.PlayerAcquisitionApplicationGetPayload<{ include: typeof applicationInclude }>;

@Injectable()
export class PlayerApplicationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MutationReceiptService) private readonly receipts: MutationReceiptService,
    @Inject(PlayerMarketAccessService) private readonly access: PlayerMarketAccessService,
    @Inject(PlayerMarketLockRepository) private readonly locks: PlayerMarketLockRepository,
    @Optional() private readonly clock: () => Date = () => new Date()
  ) {}

  async submit(
    userId: string,
    leagueId: string,
    input: SubmitPlayerApplicationRequest,
    key: string
  ): Promise<PlayerAcquisitionApplication> {
    if (input.type !== 'NORMAL_PURCHASE') {
      throw playerMarketError('APPLICATION_TYPE_INVALID', '普通购买入口不能提交强报申请', 400);
    }
    const scope = await this.access.requireParticipant(userId, leagueId, input.seasonId);
    return this.receipts.execute(userId, `player-market.submit:${leagueId}:${input.footballPlayerId}`, key, async (tx) => {
      await this.locks.lockTeam(tx, scope.leagueTeamId);
      await this.locks.lockPlayer(tx, leagueId, input.footballPlayerId);
      const now = this.clock();
      const [team, window, ownership, rosterCount, card, valuation, restriction, existing] = await Promise.all([
        tx.leagueTeam.findUnique({ where: { id: scope.leagueTeamId } }),
        tx.transferWindow.findUnique({ where: { id: input.transferWindowId } }),
        tx.leaguePlayerOwnership.findUnique({
          where: { leagueId_footballPlayerId: { leagueId, footballPlayerId: input.footballPlayerId } }
        }),
        tx.leaguePlayerOwnership.count({ where: { leagueTeamId: scope.leagueTeamId, status: 'ACTIVE' } }),
        tx.playerCard.findFirst({
          where: { id: input.playerCardId, playerId: input.footballPlayerId, status: 'ACTIVE' },
          include: { autoBuilds: { orderBy: { calculatedAt: 'desc' }, take: 1 } }
        }),
        tx.leaguePlayerValuation.findUnique({
          where: { leagueId_footballPlayerId: { leagueId, footballPlayerId: input.footballPlayerId } }
        }),
        tx.playerReleaseRestriction.findUnique({
          where: { transferWindowId_leagueTeamId_footballPlayerId: {
            transferWindowId: input.transferWindowId,
            leagueTeamId: scope.leagueTeamId,
            footballPlayerId: input.footballPlayerId
          } }
        }),
        tx.playerAcquisitionApplication.findFirst({
          where: {
            leagueId,
            seasonId: input.seasonId,
            applicantLeagueTeamId: scope.leagueTeamId,
            footballPlayerId: input.footballPlayerId,
            type: 'NORMAL_PURCHASE',
            status: { in: ['PENDING', 'REQUOTE_REQUIRED'] }
          }
        })
      ]);
      this.assertTeam(team);
      this.assertWindow(window, input.seasonId, now);
      if (ownership?.status === 'ACTIVE') throw playerMarketError('PLAYER_ALREADY_OWNED', '该球员已有归属球队');
      if (rosterCount >= 25) throw playerMarketError('ROSTER_CAPACITY_REACHED', '球队已满 25 人，请先下放球员');
      if (!card) throw playerMarketError('PLAYER_CARD_NOT_AVAILABLE', '所选球员卡不可用', 404);
      if (restriction) throw playerMarketError('RELEASED_BY_TEAM_IN_WINDOW', '本队在当前窗口下放过该球员，不能回购');
      if (existing) throw playerMarketError('ACTIVE_APPLICATION_EXISTS', '本队已有一笔有效申请');

      const created = await tx.playerAcquisitionApplication.create({
        data: {
          leagueId,
          seasonId: input.seasonId,
          transferWindowId: input.transferWindowId,
          type: 'NORMAL_PURCHASE',
          applicantLeagueTeamId: scope.leagueTeamId,
          footballPlayerId: input.footballPlayerId,
          playerCardId: input.playerCardId,
          amountMinor: input.amountMinor,
          valuationMinorSnapshot: valuation?.currentValueMinor ?? null,
          valuationVersionSnapshot: valuation?.version ?? null,
          status: 'PENDING',
          firstValidSubmittedAt: now,
          lastSubmittedAt: now
        },
        include: applicationInclude
      });
      await this.appendEvent(tx, created.id, 'SUBMITTED', null, 'PENDING', null, input.amountMinor, userId, null);
      return this.response(await this.reload(tx, created.id));
    });
  }

  async amend(
    userId: string,
    applicationId: string,
    input: AmendPlayerApplicationRequest,
    key: string
  ): Promise<PlayerAcquisitionApplication> {
    return this.receipts.execute(userId, `player-market.amend:${applicationId}`, key, async (tx) => {
      await this.locks.lockApplication(tx, applicationId);
      const current = await tx.playerAcquisitionApplication.findUnique({ where: { id: applicationId }, include: applicationInclude });
      if (!current) throw playerMarketError('PLAYER_APPLICATION_NOT_FOUND', '申请不存在', 404);
      await this.access.requireOwnedTeam(userId, current.applicantLeagueTeamId, current.seasonId);
      await this.locks.lockTeam(tx, current.applicantLeagueTeamId);
      this.assertVersion(current.version, input.expectedVersion);
      if (current.status !== 'PENDING') throw playerMarketError('APPLICATION_STATE_INVALID', '当前状态不能改价');
      const window = await tx.transferWindow.findUnique({ where: { id: current.transferWindowId } });
      const now = this.clock();
      this.assertWindow(window, current.seasonId, now);
      await tx.playerAcquisitionApplication.update({
        where: { id: current.id },
        data: { amountMinor: input.amountMinor, lastSubmittedAt: now, version: { increment: 1 } }
      });
      await this.appendEvent(tx, current.id, 'AMOUNT_CHANGED', current.status, current.status, current.amountMinor, input.amountMinor, userId, null);
      return this.response(await this.reload(tx, current.id));
    });
  }

  async withdraw(
    userId: string,
    applicationId: string,
    input: WithdrawPlayerApplicationRequest,
    key: string
  ): Promise<PlayerAcquisitionApplication> {
    return this.receipts.execute(userId, `player-market.withdraw:${applicationId}`, key, async (tx) => {
      await this.locks.lockApplication(tx, applicationId);
      const current = await tx.playerAcquisitionApplication.findUnique({ where: { id: applicationId }, include: applicationInclude });
      if (!current) throw playerMarketError('PLAYER_APPLICATION_NOT_FOUND', '申请不存在', 404);
      await this.access.requireOwnedTeam(userId, current.applicantLeagueTeamId, current.seasonId);
      this.assertVersion(current.version, input.expectedVersion);
      if (!['PENDING', 'REQUOTE_REQUIRED'].includes(current.status)) {
        throw playerMarketError('APPLICATION_STATE_INVALID', '当前状态不能撤回');
      }
      await tx.playerAcquisitionApplication.update({
        where: { id: current.id },
        data: { status: 'WITHDRAWN', reviewReason: input.reason, version: { increment: 1 } }
      });
      await this.appendEvent(tx, current.id, 'WITHDRAWN', current.status, 'WITHDRAWN', current.amountMinor, current.amountMinor, userId, input.reason);
      return this.response(await this.reload(tx, current.id));
    });
  }

  private assertTeam(team: { status: string; rosterStatus: string } | null): void {
    if (!team || team.status !== 'ACTIVE') throw playerMarketError('LEAGUE_TEAM_INELIGIBLE', '球队已退出或不可用');
    if (team.rosterStatus !== 'COMPLIANT') throw playerMarketError('ROSTER_NON_COMPLIANT', '球队工资帽状态不合规');
  }

  private assertWindow(window: { seasonId: string; allowBuy: boolean; startsAt: Date; endsAt: Date } | null, seasonId: string, at: Date): void {
    if (!window || window.seasonId !== seasonId || !window.allowBuy || at < window.startsAt || at >= window.endsAt) {
      throw playerMarketError('TRANSFER_WINDOW_CLOSED', '当前不在可购买的转会窗口内');
    }
  }

  private assertVersion(actual: number, expected: number): void {
    if (actual !== expected) throw playerMarketError('VERSION_CONFLICT', '申请已被其他操作更新，请刷新后重试');
  }

  private async appendEvent(
    tx: Prisma.TransactionClient,
    applicationId: string,
    type: PlayerApplicationEventType,
    fromStatus: ApplicationRow['status'] | null,
    toStatus: ApplicationRow['status'],
    fromAmountMinor: number | null,
    toAmountMinor: number | null,
    actorUserId: string,
    reason: string | null
  ): Promise<void> {
    await tx.playerAcquisitionApplicationEvent.create({
      data: { applicationId, type, fromStatus, toStatus, fromAmountMinor, toAmountMinor, actorUserId, reason }
    });
  }

  private async reload(tx: Prisma.TransactionClient, id: string): Promise<ApplicationRow> {
    const row = await tx.playerAcquisitionApplication.findUnique({ where: { id }, include: applicationInclude });
    if (!row) throw playerMarketError('PLAYER_APPLICATION_NOT_FOUND', '申请不存在', 404);
    return row;
  }

  private response(row: ApplicationRow): PlayerAcquisitionApplication {
    const build = row.playerCard.autoBuilds[0];
    return {
      id: row.id,
      leagueId: row.leagueId,
      seasonId: row.seasonId,
      transferWindowId: row.transferWindowId,
      type: row.type,
      applicantTeam: this.team(row.applicantLeagueTeam),
      playerId: row.footballPlayerId,
      playerName: row.footballPlayer.nameZh ?? row.footballPlayer.nameEn ?? row.footballPlayer.shortName ?? '未命名球员',
      playerCard: {
        playerCardId: row.playerCard.id,
        cardName: row.playerCard.cardName,
        imageUrl: row.playerCard.imageUrl,
        position: row.playerCard.position,
        maxOverall: build?.maxOverall ?? row.playerCard.overallRating,
        salaryMinor: null
      },
      sourceTeam: row.sourceLeagueTeam ? this.team(row.sourceLeagueTeam) : null,
      ownershipId: row.ownershipId,
      ownershipVersionSnapshot: row.ownershipVersionSnapshot,
      amountMinor: row.amountMinor,
      valuationMinorSnapshot: row.valuationMinorSnapshot,
      valuationVersionSnapshot: row.valuationVersionSnapshot,
      status: row.status,
      queuePosition: null,
      firstValidSubmittedAt: row.firstValidSubmittedAt.toISOString(),
      lastSubmittedAt: row.lastSubmittedAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewReason: row.reviewReason,
      version: row.version,
      events: row.events.map((event) => ({
        id: event.id,
        type: event.type,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        fromAmountMinor: event.fromAmountMinor,
        toAmountMinor: event.toAmountMinor,
        actorType: event.actorUserId ? 'USER' : event.actorAdminId ? 'ADMIN' : 'SYSTEM',
        actorDisplayName: event.actorUser?.displayName ?? event.actorAdmin?.displayName ?? '系统',
        reason: event.reason,
        createdAt: event.createdAt.toISOString()
      }))
    };
  }

  private team(team: { id: string; teamNumber: number | null; name: string; logoUrl: string | null; ownerAlias: string }) {
    return { teamId: team.id, teamNumber: team.teamNumber, name: team.name, logoUrl: team.logoUrl, ownerAlias: team.ownerAlias };
  }
}
