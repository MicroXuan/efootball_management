import { jest } from '@jest/globals';
import { SeasonRosterReadinessService } from './season-roster-readiness.service.js';

const roster = (teamId: string, count: number, goalkeeper = true, salaryMinor = 100) =>
  Array.from({ length: count }, (_, index) => ({
    leagueTeamId: teamId, salaryMinor,
    currentPlayerCard: { position: goalkeeper && index === 0 ? 'GK' : 'CF' }
  }));

function harness(players: ReturnType<typeof roster>, salaryCapMinor: number | null = 2_500) {
  const client = {
    leagueSeason: { findUnique: jest.fn(async () => ({ leagueId: 'league-1' })) },
    seasonEntry: { findMany: jest.fn(async () => [{
      leagueTeamId: 'team-1', leagueTeam: {
        id: 'team-1', name: '一队', teamNumber: 1, salaryCapMinor
      }
    }]) },
    leaguePlayerOwnership: { findMany: jest.fn(async () => players) },
    $queryRaw: jest.fn(async () => [])
  };
  return { client, service: new SeasonRosterReadinessService(client as never) };
}

describe('SeasonRosterReadinessService', () => {
  it('accepts 16 and 25 active players with a GK and a configured cap', async () => {
    for (const count of [16, 25]) {
      const { service, client } = harness(roster('team-1', count));
      await expect(service.evaluate(client as never, 'season-1'))
        .resolves.toMatchObject({ ready: true, teams: [{ playerCount: count, goalkeeperCount: 1, issues: [] }] });
      expect(client.leaguePlayerOwnership.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { leagueId: 'league-1', leagueTeamId: { in: ['team-1'] }, status: 'ACTIVE' }
      }));
    }
  });

  it('reports too few, too many, no GK, missing cap and over cap per team', async () => {
    const cases = [
      [roster('team-1', 15), 2_500, ['UNDER_MINIMUM']],
      [roster('team-1', 26), 2_500, ['OVER_MAXIMUM', 'OVER_CAP']],
      [roster('team-1', 16, false), 2_500, ['NO_GOALKEEPER']],
      [roster('team-1', 16), null, ['SALARY_CAP_UNSET']],
      [roster('team-1', 16), 1_500, ['OVER_CAP']]
    ] as const;
    for (const [players, cap, issues] of cases) {
      const { service, client } = harness(players, cap);
      const result = await service.evaluate(client as never, 'season-1');
      expect(result.ready).toBe(false);
      expect(result.teams[0]?.issues).toEqual(issues);
    }
  });

  it('blocks publication before any schedule state changes', async () => {
    const { service, client } = harness(roster('team-1', 15));
    await expect(service.assertReady(client as never, 'season-1'))
      .rejects.toMatchObject({ code: 'SEASON_ROSTER_NOT_READY' });
    expect(client.$queryRaw).toHaveBeenCalled();
  });
});
