import { Inject, Injectable } from '@nestjs/common';
import type { ActionCenterItem, ActionCenterResponse, PlayerApplicationStatus } from '@efm/contracts';
import { PrismaService } from '../database/prisma.service.js';

const ACTIVE_AUCTION_STATUSES = ['READY', 'ACTIVE', 'PAUSED', 'RECOVERY_REQUIRED'] as const;
const CURRENT_APPLICATION_STATUSES: PlayerApplicationStatus[] = ['PENDING', 'REQUOTE_REQUIRED'];

type TeamRow = {
  id: string;
  name: string;
  leagueId: string;
  league: { id: string; name: string; currentSeasonId: string | null };
};

type ApplicationRow = {
  id: string;
  leagueId: string;
  seasonId: string;
  applicantLeagueTeamId: string;
  sourceLeagueTeamId: string | null;
  type: 'NORMAL_PURCHASE' | 'FORCED_TRANSFER';
  status: PlayerApplicationStatus;
  updatedAt: Date;
  league: { id: string; name: string };
  applicantLeagueTeam: { id: string; name: string };
  sourceLeagueTeam: { id: string; name: string } | null;
  footballPlayer: { nameZh: string | null; nameEn: string | null; shortName: string | null };
};

type AuctionRow = {
  id: string;
  leagueId: string;
  name: string;
  status: 'READY' | 'ACTIVE' | 'PAUSED' | 'RECOVERY_REQUIRED';
  updatedAt: Date;
  league: { id: string; name: string };
  currentLot: { playerNameSnapshot: string } | null;
};

@Injectable()
export class ActionCenterService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<ActionCenterResponse> {
    const teams = await this.prisma.leagueTeam.findMany({
      where: { ownerUserId: userId, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        leagueId: true,
        league: { select: { id: true, name: true, currentSeasonId: true } }
      }
    }) as TeamRow[];
    if (teams.length === 0) return { items: [], actionRequiredCount: 0 };

    const teamIds = teams.map(({ id }) => id);
    const seasonIds = teams.flatMap(({ league }) => league.currentSeasonId ? [league.currentSeasonId] : []);
    const leagueIds = [...new Set(teams.map(({ leagueId }) => leagueId))];
    const recentCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [applications, auctions] = await Promise.all([
      seasonIds.length === 0
        ? Promise.resolve([] as ApplicationRow[])
        : this.prisma.playerAcquisitionApplication.findMany({
          where: {
            seasonId: { in: seasonIds },
            status: { not: 'WITHDRAWN' },
            AND: [{
              OR: [
                { status: { in: CURRENT_APPLICATION_STATUSES } },
                { updatedAt: { gte: recentCutoff } }
              ]
            }],
            OR: [
              { applicantLeagueTeamId: { in: teamIds } },
              { sourceLeagueTeamId: { in: teamIds }, type: 'FORCED_TRANSFER' }
            ]
          },
          include: {
            league: { select: { id: true, name: true } },
            applicantLeagueTeam: { select: { id: true, name: true } },
            sourceLeagueTeam: { select: { id: true, name: true } },
            footballPlayer: { select: { nameZh: true, nameEn: true, shortName: true } }
          },
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          take: 100
        }) as Promise<ApplicationRow[]>,
      this.prisma.playerAuctionBatch.findMany({
        where: {
          leagueId: { in: leagueIds },
          bidChannel: 'MINIPROGRAM',
          status: { in: [...ACTIVE_AUCTION_STATUSES] }
        },
        include: {
          league: { select: { id: true, name: true } },
          currentLot: { select: { playerNameSnapshot: true } }
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }]
      }) as Promise<AuctionRow[]>
    ]);

    const teamByLeague = new Map(teams.map((team) => [team.leagueId, team]));
    const items = [
      ...applications.flatMap((application) => {
        const team = teamByLeague.get(application.leagueId);
        return team ? [this.applicationItem(application, team, teamIds)] : [];
      }),
      ...auctions.flatMap((auction) => {
        const team = teamByLeague.get(auction.leagueId);
        return team ? [this.auctionItem(auction, team)] : [];
      })
    ].sort((left, right) => {
      const priority = { ACTION_REQUIRED: 0, STATUS_UPDATE: 1, RECENT: 2 } as const;
      return priority[left.section] - priority[right.section]
        || right.occurredAt.localeCompare(left.occurredAt)
        || left.id.localeCompare(right.id);
    });

    return {
      items,
      actionRequiredCount: items.filter(({ section }) => section === 'ACTION_REQUIRED').length
    };
  }

  private applicationItem(application: ApplicationRow, team: TeamRow, teamIds: string[]): ActionCenterItem {
    const mine = teamIds.includes(application.applicantLeagueTeamId);
    const incomingForced = !mine && application.type === 'FORCED_TRANSFER'
      && Boolean(application.sourceLeagueTeamId && teamIds.includes(application.sourceLeagueTeamId));
    const playerName = application.footballPlayer.nameZh
      ?? application.footballPlayer.nameEn
      ?? application.footballPlayer.shortName
      ?? '未命名球员';
    const source = application.type === 'FORCED_TRANSFER' ? 'FORCED_TRANSFER' as const : 'TRANSACTION' as const;
    const section = application.status === 'REQUOTE_REQUIRED'
      ? 'ACTION_REQUIRED' as const
      : CURRENT_APPLICATION_STATUSES.includes(application.status)
        ? 'STATUS_UPDATE' as const
        : 'RECENT' as const;
    const statusLabel = this.applicationStatus(application.status);
    const view = incomingForced ? 'public' : 'mine';
    const title = incomingForced
      ? '收到强报申请'
      : application.status === 'REQUOTE_REQUIRED'
        ? `${application.type === 'FORCED_TRANSFER' ? '强报' : '购买申请'}需要重新报价`
        : `${application.type === 'FORCED_TRANSFER' ? '强报' : '购买申请'}${statusLabel}`;
    const detail = incomingForced
      ? `${application.applicantLeagueTeam.name} 强报 ${playerName}`
      : `${playerName} · ${team.name}`;
    return {
      id: incomingForced ? `forced:${application.id}` : `application:${application.id}`,
      version: application.updatedAt.toISOString(),
      source,
      section,
      league: application.league,
      seasonId: application.seasonId,
      teamId: team.id,
      title,
      detail,
      statusLabel: incomingForced ? '等待管理员处理' : statusLabel,
      occurredAt: application.updatedAt.toISOString(),
      route: `/pages/player-market/index?leagueId=${encodeURIComponent(application.leagueId)}&seasonId=${encodeURIComponent(application.seasonId)}&teamId=${encodeURIComponent(team.id)}&view=${view}`
    };
  }

  private auctionItem(auction: AuctionRow, team: TeamRow): ActionCenterItem {
    const active = auction.status === 'ACTIVE';
    const labels = {
      READY: '等待开始', ACTIVE: '拍卖中', PAUSED: '已暂停', RECOVERY_REQUIRED: '等待恢复'
    } as const;
    const titles = {
      READY: '球员拍卖即将开始', ACTIVE: '球员拍卖进行中', PAUSED: '球员拍卖已暂停', RECOVERY_REQUIRED: '球员拍卖等待恢复'
    } as const;
    return {
      id: `auction:${auction.id}`,
      version: auction.updatedAt.toISOString(),
      source: 'AUCTION',
      section: active ? 'ACTION_REQUIRED' : 'STATUS_UPDATE',
      league: auction.league,
      seasonId: null,
      teamId: team.id,
      title: titles[auction.status],
      detail: auction.currentLot ? `当前球员：${auction.currentLot.playerNameSnapshot}` : auction.name,
      statusLabel: labels[auction.status],
      occurredAt: auction.updatedAt.toISOString(),
      route: `/pages/auction-room/index?batchId=${encodeURIComponent(auction.id)}`
    };
  }

  private applicationStatus(status: PlayerApplicationStatus): string {
    const labels: Record<PlayerApplicationStatus, string> = {
      PENDING: '审核中', APPROVED: '已通过', NOT_SELECTED: '未选中', REJECTED: '已驳回',
      WITHDRAWN: '已撤回', EXPIRED: '已过期', INELIGIBLE: '资格失效', REQUOTE_REQUIRED: '需重新报价',
      OWNERSHIP_CHANGED: '归属已变化'
    };
    return labels[status];
  }
}
