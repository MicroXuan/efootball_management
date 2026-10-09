import { jest } from '@jest/globals';
import { LeagueTeamsService } from './league-teams.service.js';

describe('LeagueTeamsService roster summary', () => {
  it('returns the active roster count, salary total, and current salary cap', async () => {
    const team = {
      id: '22222222-2222-4222-8222-222222222222',
      leagueId: '11111111-1111-4111-8111-111111111111',
      ownerUserId: '33333333-3333-4333-8333-333333333333',
      ownerAlias: 'tidus',
      catalogTeamId: '44444444-4444-4444-8444-444444444444',
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
    const service = new LeagueTeamsService(prisma as never, {} as never, {} as never, {
      requireVisible: async () => 'league-1'
    } as never);

    const result = await service.listForLeague(team.leagueId);

    expect(result.items[0]).toMatchObject({
      ownerDisplayName: '用户一',
      ownerAlias: 'tidus',
      catalogTeamId: '44444444-4444-4444-8444-444444444444',
      activePlayerCount: 3,
      salaryTotalMinor: 1_200,
      salaryCapMinor: 2_000
    });
  });

  it('includes each active player position and height in the owner overview', async () => {
    const team = {
      id: '22222222-2222-4222-8222-222222222222',
      leagueId: '11111111-1111-4111-8111-111111111111',
      name: '测试球队'
    };
    const prisma = {
      league: { findUniqueOrThrow: async () => ({ name: '测试联赛' }) },
      leaguePlayerOwnership: {
        findMany: async () => [{
          id: 'ownership-1',
          leagueId: team.leagueId,
          leagueTeamId: team.id,
          footballPlayerId: 'player-1',
          currentPlayerCardId: 'card-1',
          maxOverallSnapshot: 95,
          salaryRuleVersionId: 'salary-rule-1',
          salaryMinor: 800,
          acquiredAt: new Date('2026-09-15T00:00:00.000Z'),
          status: 'ACTIVE',
          version: 1,
          footballPlayer: { nameZh: '测试中卫', nameEn: null, shortName: null },
          currentPlayerCard: {
            cardName: '精选卡',
            position: 'CB',
            attributes: { attributesJson: { height: 191 } }
          }
        }]
      },
      financeLedgerEntry: { findMany: async () => [] },
      transferWindow: { findFirst: async () => null }
    };
    const service = new LeagueTeamsService(prisma as never, {} as never, {} as never, {} as never);
    jest.spyOn(service, 'getDetail').mockResolvedValue(team as never);

    const result = await service.getMyOverview(team.id, 'owner-1');

    expect(result.roster[0]).toMatchObject({
      playerName: '测试中卫',
      position: 'CB',
      heightCm: 191,
      salaryMinor: 800
    });
  });
});
