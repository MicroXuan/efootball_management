import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { paginateWechatMessage } from './wechat-message-formatter.js';

const UNFINISHED_MATCH_STATUSES = ['SCHEDULED', 'AWAITING_RESULT', 'PENDING_CONFIRMATION'] as const;

@Injectable()
export class WechatScheduleQueryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async query(groupBindingId: string, userId?: string): Promise<string[]> {
    const binding = await this.prisma.wechatGroupBinding.findUnique({
      where: { id: groupBindingId },
      select: {
        enabled: true,
        leagueId: true,
        scheduleSources: {
          where: { enabled: true },
          orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
          select: {
            competitionId: true,
            displayOrder: true,
            competition: {
              select: {
                name: true,
                status: true,
                season: { select: { leagueId: true } }
              }
            }
          }
        }
      }
    });
    if (!binding?.enabled) return ['本群机器人尚未启用。'];

    const sources = binding.scheduleSources
      .filter((source) => (
        source.competition.status !== 'CANCELLED'
        && source.competition.season?.leagueId === binding.leagueId
      ))
      .sort((left, right) => left.displayOrder - right.displayOrder || left.competitionId.localeCompare(right.competitionId));
    if (sources.length === 0) return ['本群尚未配置赛程来源。'];

    let participantScope: object | undefined;
    if (userId) {
      const team = await this.prisma.leagueTeam.findFirst({
        where: { leagueId: binding.leagueId, ownerUserId: userId, status: 'ACTIVE' },
        select: { id: true }
      });
      if (!team) return ['你尚未绑定本联赛的球队。'];
      const participant = {
        OR: [
          { individualUserId: userId },
          { seasonEntry: { leagueTeamId: team.id } }
        ]
      };
      participantScope = {
        OR: [
          { homeParticipant: participant },
          { awayParticipant: participant }
        ]
      };
    }

    const sourceIds = sources.map((source) => source.competitionId);
    const matches = await this.prisma.competitionMatch.findMany({
      where: {
        stage: {
          status: 'PUBLISHED',
          competitionId: { in: sourceIds },
          competition: { status: { not: 'CANCELLED' } }
        },
        status: { in: [...UNFINISHED_MATCH_STATUSES] },
        ...participantScope
      },
      select: {
        id: true,
        roundNumber: true,
        matchNumber: true,
        plannedAt: true,
        status: true,
        stage: {
          select: {
            displayName: true,
            competitionId: true,
            competition: { select: { name: true } }
          }
        },
        homeParticipant: { select: { displayNameSnapshot: true } },
        awayParticipant: { select: { displayNameSnapshot: true } }
      }
    });

    const orderBySource = new Map(sources.map((source) => [source.competitionId, source.displayOrder]));
    matches.sort((left, right) => {
      if (left.plannedAt && !right.plannedAt) return -1;
      if (!left.plannedAt && right.plannedAt) return 1;
      if (left.plannedAt && right.plannedAt) {
        const dateOrder = left.plannedAt.getTime() - right.plannedAt.getTime();
        if (dateOrder !== 0) return dateOrder;
      }
      const sourceOrder = (orderBySource.get(left.stage.competitionId) ?? 0)
        - (orderBySource.get(right.stage.competitionId) ?? 0);
      if (sourceOrder !== 0) return sourceOrder;
      const competitionOrder = left.stage.competition.name.localeCompare(right.stage.competition.name, 'zh-CN');
      if (competitionOrder !== 0) return competitionOrder;
      return left.roundNumber - right.roundNumber || left.matchNumber - right.matchNumber || left.id.localeCompare(right.id);
    });

    if (matches.length === 0) return [userId ? '你目前没有待进行的赛程。' : '当前没有待进行的赛程。'];
    const lines = matches.map((match, index) => {
      const time = match.plannedAt
        ? new Intl.DateTimeFormat('zh-CN', {
            timeZone: 'Asia/Shanghai',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          }).format(match.plannedAt)
        : '时间待定';
      const stageName = match.stage.displayName ? `·${match.stage.displayName}` : '';
      return `${index + 1}. ${match.stage.competition.name}${stageName} 第${match.roundNumber}轮\n${match.homeParticipant.displayNameSnapshot} vs ${match.awayParticipant.displayNameSnapshot}｜${time}`;
    });
    return paginateWechatMessage(userId ? `我的赛程（${matches.length}场）` : `赛程（${matches.length}场）`, lines);
  }
}
