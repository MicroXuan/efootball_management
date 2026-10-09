/* eslint-disable @typescript-eslint/no-explicit-any -- focused Prisma test doubles */
import { jest } from '@jest/globals';
import { paginateWechatMessage } from './wechat-message-formatter.js';
import { WechatScheduleQueryService } from './wechat-schedule-query.service.js';

const activeBinding = {
  id: 'binding-1',
  enabled: true,
  leagueId: 'league-1',
  scheduleSources: [
    {
      competitionId: 'competition-2',
      displayOrder: 2,
      competition: { name: '联盟杯', status: 'SCHEDULED', season: { leagueId: 'league-1' } }
    },
    {
      competitionId: 'competition-1',
      displayOrder: 1,
      competition: { name: '甲级联赛', status: 'IN_PROGRESS', season: { leagueId: 'league-1' } }
    },
    {
      competitionId: 'competition-other-league',
      displayOrder: 0,
      competition: { name: '其他联盟', status: 'IN_PROGRESS', season: { leagueId: 'league-2' } }
    },
    {
      competitionId: 'competition-cancelled',
      displayOrder: 0,
      competition: { name: '已取消', status: 'CANCELLED', season: { leagueId: 'league-1' } }
    }
  ]
};

function match(overrides: Record<string, unknown>) {
  return {
    id: 'match-1',
    roundNumber: 1,
    matchNumber: 1,
    plannedAt: new Date('2026-10-10T12:00:00.000Z'),
    status: 'SCHEDULED',
    stage: { displayName: '常规赛', competitionId: 'competition-1', competition: { name: '甲级联赛' } },
    homeParticipant: { displayNameSnapshot: '主队' },
    awayParticipant: { displayNameSnapshot: '客队' },
    ...overrides
  };
}

describe('WechatScheduleQueryService', () => {
  function harness(binding: any = activeBinding, matches: any[] = []) {
    const prisma: any = {
      wechatGroupBinding: { findUnique: jest.fn(async () => binding) },
      leagueTeam: { findFirst: jest.fn(async () => ({ id: 'team-1' })) },
      competitionMatch: { findMany: jest.fn(async () => matches) }
    };
    return { service: new WechatScheduleQueryService(prisma), prisma };
  }

  it('reports disabled groups and groups without schedule sources explicitly', async () => {
    const disabled = harness({ ...activeBinding, enabled: false });
    await expect(disabled.service.query('binding-1')).resolves.toEqual(['本群机器人尚未启用。']);

    const empty = harness({ ...activeBinding, scheduleSources: [] });
    await expect(empty.service.query('binding-1')).resolves.toEqual(['本群尚未配置赛程来源。']);
  });

  it('queries only selected, published, unfinished schedules and sorts planned games before unscheduled games', async () => {
    const { service, prisma } = harness(activeBinding, [
      match({ id: 'unplanned', plannedAt: null, roundNumber: 3 }),
      match({ id: 'later', plannedAt: new Date('2026-10-12T12:00:00.000Z'), roundNumber: 2 }),
      match({ id: 'earlier', plannedAt: new Date('2026-10-11T12:00:00.000Z'), roundNumber: 1 })
    ]);

    const pages = await service.query('binding-1');

    expect(prisma.competitionMatch.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        stage: expect.objectContaining({
          status: 'PUBLISHED',
          competitionId: { in: ['competition-1', 'competition-2'] }
        }),
        status: { in: ['SCHEDULED', 'AWAITING_RESULT', 'PENDING_CONFIRMATION'] }
      })
    }));
    expect(pages.join('\n').indexOf('10月11日')).toBeLessThan(pages.join('\n').indexOf('10月12日'));
    expect(pages.join('\n').indexOf('10月12日')).toBeLessThan(pages.join('\n').indexOf('时间待定'));
  });

  it('requires an active team in the bound league and scopes my schedule to its participants', async () => {
    const { service, prisma } = harness(activeBinding, []);
    prisma.leagueTeam.findFirst.mockResolvedValueOnce(null);
    await expect(service.query('binding-1', 'user-1')).resolves.toEqual(['你尚未绑定本联赛的球队。']);
    expect(prisma.competitionMatch.findMany).not.toHaveBeenCalled();

    await service.query('binding-1', 'user-1');
    expect(prisma.leagueTeam.findFirst).toHaveBeenLastCalledWith({
      where: { leagueId: 'league-1', ownerUserId: 'user-1', status: 'ACTIVE' },
      select: { id: true }
    });
    expect(prisma.competitionMatch.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [
          { homeParticipant: { OR: [{ individualUserId: 'user-1' }, { seasonEntry: { leagueTeamId: 'team-1' } }] } },
          { awayParticipant: { OR: [{ individualUserId: 'user-1' }, { seasonEntry: { leagueTeamId: 'team-1' } }] } }
        ]
      })
    }));
  });

  it('paginates long replies without exceeding the WeChat safety limit', () => {
    const pages = paginateWechatMessage('赛程', Array.from({ length: 100 }, (_, index) => `${index + 1}. 一场很长的测试赛程`));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => page.length <= 800)).toBe(true);
  });
});
