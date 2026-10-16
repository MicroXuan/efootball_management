import { Inject, Injectable } from '@nestjs/common';
import type { ActionCenterItem, ActionCenterResponse, PlayerApplicationStatus } from '@efm/contracts';
import type { Prisma } from '../generated/prisma/client.js';
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

const MATCH_SELECT = {
  id: true, status: true, updatedAt: true, resultConfirmationDeadlineAt: true,
  stage: { select: { competition: { select: { seasonId: true,
    season: { select: { league: { select: { id: true, name: true } } } }
  } } } },
  homeParticipant: { select: { displayNameSnapshot: true, seasonEntry: { select: {
    ownerUserId: true, leagueTeam: { select: { id: true, status: true } }
  } } } },
  awayParticipant: { select: { displayNameSnapshot: true, seasonEntry: { select: {
    ownerUserId: true, leagueTeam: { select: { id: true, status: true } }
  } } } },
  resultVersions: { where: { status: 'PROPOSED' }, orderBy: { version: 'desc' }, take: 1,
    select: { submittedById: true, homeScore: true, awayScore: true, updatedAt: true } },
  resultDisputes: { orderBy: { createdAt: 'desc' }, take: 1, select: {
    status: true, evidenceDeadlineAt: true, updatedAt: true,
    triggerResultVersion: { select: { submittedById: true } },
    evidence: { select: { role: true, status: true, updatedAt: true } }
  } },
  officialResultVersion: { select: { homeScore: true, awayScore: true, reason: true, updatedAt: true } }
} satisfies Prisma.CompetitionMatchSelect;

type MatchRow = Prisma.CompetitionMatchGetPayload<{ select: typeof MATCH_SELECT }>;

@Injectable()
export class ActionCenterService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<ActionCenterResponse> {
    const teams = await this.prisma.leagueTeam.findMany({
      where: { ownerUserId: userId, status: 'ACTIVE', league: { isDeleted: false } },
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
    const now = Date.now();
    const recentCutoff = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const matchWhere: Prisma.CompetitionMatchWhereInput = {
      stage: { status: 'PUBLISHED' as const, competition: {
        status: { in: ['IN_PROGRESS', 'COMPLETED'] },
        seasonId: { in: seasonIds },
        season: { league: { isDeleted: false } }
      } },
      OR: [
        { homeParticipant: { seasonEntry: { ownerUserId: userId, leagueTeam: { status: 'ACTIVE' as const } } } },
        { awayParticipant: { seasonEntry: { ownerUserId: userId, leagueTeam: { status: 'ACTIVE' as const } } } }
      ]
    };
    const [currentApplications, recentApplications, auctions, currentMatches, recentMatches] = await Promise.all([
      seasonIds.length === 0
        ? Promise.resolve([] as ApplicationRow[])
        : this.prisma.playerAcquisitionApplication.findMany({
          where: {
            seasonId: { in: seasonIds },
            status: { in: CURRENT_APPLICATION_STATUSES },
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
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }]
        }) as Promise<ApplicationRow[]>,
      seasonIds.length === 0
        ? Promise.resolve([] as ApplicationRow[])
        : this.prisma.playerAcquisitionApplication.findMany({
          where: {
            seasonId: { in: seasonIds },
            status: { notIn: [...CURRENT_APPLICATION_STATUSES, 'WITHDRAWN'] },
            updatedAt: { gte: recentCutoff },
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
      }) as Promise<AuctionRow[]>,
      seasonIds.length === 0 ? Promise.resolve([] as MatchRow[]) : this.prisma.competitionMatch.findMany({
        where: { ...matchWhere, status: { in: ['PENDING_CONFIRMATION', 'DISPUTED'] } },
        select: MATCH_SELECT,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }]
      }),
      seasonIds.length === 0 ? Promise.resolve([] as MatchRow[]) : this.prisma.competitionMatch.findMany({
        where: { ...matchWhere, status: { in: ['CONFIRMED', 'ADMIN_DECIDED'] },
          updatedAt: { gte: recentCutoff } },
        select: MATCH_SELECT,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 100
      })
    ]);

    const applications = [...new Map(
      [...currentApplications, ...recentApplications].map((application) => [application.id, application])
    ).values()];
    const matches = [...new Map(
      [...currentMatches, ...recentMatches].map((match) => [match.id, match])
    ).values()];
    const teamByLeague = new Map(teams.map((team) => [team.leagueId, team]));
    const items = [
      ...applications.flatMap((application) => {
        const team = teamByLeague.get(application.leagueId);
        return team ? [this.applicationItem(application, team, teamIds)] : [];
      }),
      ...auctions.flatMap((auction) => {
        const team = teamByLeague.get(auction.leagueId);
        return team ? [this.auctionItem(auction, team)] : [];
      }),
      ...matches.flatMap((match) => {
        const item = this.matchItem(match, userId, teamIds, now);
        return item ? [item] : [];
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

  private matchItem(match: MatchRow, userId: string, teamIds: string[], now: number): ActionCenterItem | null {
    const participant = [match.homeParticipant, match.awayParticipant].find((entry) =>
      entry.seasonEntry?.ownerUserId === userId && entry.seasonEntry.leagueTeam?.status === 'ACTIVE'
        && teamIds.includes(entry.seasonEntry.leagueTeam.id));
    const teamId = participant?.seasonEntry?.leagueTeam?.id;
    const competition = match.stage.competition;
    if (!teamId || !competition.seasonId || !competition.season) return null;

    const proposal = match.resultVersions[0];
    const dispute = match.resultDisputes[0];
    let section: ActionCenterItem['section'];
    let title: string;
    let statusLabel: string;
    let detail = `${match.homeParticipant.displayNameSnapshot} 对 ${match.awayParticipant.displayNameSnapshot}`;
    let version = match.updatedAt;

    if ((match.status === 'CONFIRMED' || match.status === 'ADMIN_DECIDED' || dispute?.status === 'RESOLVED')
      && match.officialResultVersion) {
      section = 'RECENT';
      title = match.status === 'CONFIRMED' ? '比分已确认' : '赛果裁决完成';
      statusLabel = match.status === 'CONFIRMED' ? '已确认' : '已裁决';
      detail += ` · ${match.officialResultVersion.homeScore}:${match.officialResultVersion.awayScore}`;
      const reason = match.officialResultVersion.reason?.trim();
      if (reason && /^[\p{L}\p{N}\s，。！？、；（）《》「」『』]+$/u.test(reason)) detail += ` · ${reason}`;
      version = [match.updatedAt, match.officialResultVersion.updatedAt, dispute?.updatedAt ?? match.updatedAt]
        .reduce((latest, updated) => updated > latest ? updated : latest);
    } else if (match.status === 'PENDING_CONFIRMATION' && proposal) {
      const expired = Boolean(match.resultConfirmationDeadlineAt && match.resultConfirmationDeadlineAt.getTime() <= now);
      const mine = proposal.submittedById === userId;
      section = expired && mine || !expired && !mine ? 'ACTION_REQUIRED' : 'STATUS_UPDATE';
      title = expired ? mine ? '上传截图并申请仲裁' : '比分确认已超时'
        : mine ? '等待对手确认比分' : '确认比分';
      statusLabel = expired ? '确认超时' : mine ? '等待确认' : '待确认';
      detail += ` · ${proposal.homeScore}:${proposal.awayScore}`;
      version = expired && match.resultConfirmationDeadlineAt ? match.resultConfirmationDeadlineAt : proposal.updatedAt;
    } else if (match.status === 'DISPUTED' && dispute) {
      const role = dispute.triggerResultVersion.submittedById === userId ? 'SUBMITTER' : 'OPPONENT';
      const ownEvidence = dispute.evidence.some((entry) => entry.role === role && entry.status === 'ACTIVE');
      const collecting = dispute.status === 'EVIDENCE_COLLECTION' && dispute.evidenceDeadlineAt.getTime() > now;
      section = collecting && !ownEvidence ? 'ACTION_REQUIRED' : 'STATUS_UPDATE';
      title = section === 'ACTION_REQUIRED' ? '上传截图补充证据'
        : collecting ? '等待双方补充证据' : '等待管理员裁决';
      statusLabel = section === 'ACTION_REQUIRED' ? '需要补证'
        : collecting ? '证据收集中' : '等待仲裁';
      version = dispute.evidence.reduce((latest, entry) => entry.updatedAt > latest ? entry.updatedAt : latest, dispute.updatedAt);
      if (!collecting && dispute.status === 'EVIDENCE_COLLECTION') version = dispute.evidenceDeadlineAt;
    } else return null;

    return {
      id: `match-result:${match.id}`, version: version.toISOString(), source: 'MATCH_RESULT', section,
      league: competition.season.league, seasonId: competition.seasonId, teamId,
      title, detail: detail.slice(0, 256), statusLabel,
      occurredAt: match.updatedAt.toISOString(),
      route: `/pages/match-result/index?id=${encodeURIComponent(match.id)}`
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
    const section = incomingForced
      ? CURRENT_APPLICATION_STATUSES.includes(application.status)
        ? 'STATUS_UPDATE' as const
        : 'RECENT' as const
      : application.status === 'REQUOTE_REQUIRED'
        ? 'ACTION_REQUIRED' as const
        : CURRENT_APPLICATION_STATUSES.includes(application.status)
          ? 'STATUS_UPDATE' as const
          : 'RECENT' as const;
    const statusLabel = this.applicationStatus(application.status);
    const incomingStatusLabel = this.incomingForcedStatus(application.status);
    const view = incomingForced ? 'public' : 'mine';
    const title = incomingForced
      ? CURRENT_APPLICATION_STATUSES.includes(application.status)
        ? '收到强报申请'
        : `收到的${incomingStatusLabel}`
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
      statusLabel: incomingForced ? incomingStatusLabel : statusLabel,
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

  private incomingForcedStatus(status: PlayerApplicationStatus): string {
    const labels: Record<PlayerApplicationStatus, string> = {
      PENDING: '等待管理员处理', APPROVED: '强报已通过', NOT_SELECTED: '未被选中', REJECTED: '强报已驳回',
      WITHDRAWN: '已撤回', EXPIRED: '强报已过期', INELIGIBLE: '资格失效', REQUOTE_REQUIRED: '对方需重新报价',
      OWNERSHIP_CHANGED: '归属已变化'
    };
    return labels[status];
  }
}
