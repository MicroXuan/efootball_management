import { LeagueTeamsService } from './league-teams.service.js';

describe('LeagueTeamsService roster summary', () => {
  it('returns the active roster count, salary total, and current salary cap', async () => {
    const team = {
      id: '22222222-2222-4222-8222-222222222222',
      leagueId: '11111111-1111-4111-8111-111111111111',
      ownerUserId: '33333333-3333-4333-8333-333333333333',
      teamNumber: 7,
      name: '测试球队',
      shortName: '测试',
      logoUrl: null,
      defaultGameAccountId: null,
      status: 'ACTIVE',
      rosterStatus: 'COMPLIANT',
      version: 1,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      owner: { publicUserNo: '100001', displayName: '用户一' },
      _count: { seasonEntries: 1 }
    };
    const prisma = {
      leagueTeam: { findMany: async () => [team] },
      leaguePlayerOwnership: {
        groupBy: async () => [{ leagueTeamId: team.id, _count: { _all: 3 }, _sum: { salaryMinor: 1_200 } }]
      },
      leagueSalaryRuleVersion: {
        findMany: async () => [{ leagueId: team.leagueId, salaryCapMinor: 2_000 }]
      }
    };
    const service = new LeagueTeamsService(prisma as never, {} as never, {} as never);

    const result = await service.listForLeague(team.leagueId);

    expect(result.items[0]).toMatchObject({
      ownerDisplayName: '用户一',
      activePlayerCount: 3,
      salaryTotalMinor: 1_200,
      salaryCapMinor: 2_000
    });
  });
});
