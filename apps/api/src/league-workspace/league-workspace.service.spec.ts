import { describe, expect, it, jest } from '@jest/globals';
import { LeagueWorkspaceService } from './league-workspace.service.js';
import { LeagueError } from '../leagues/league.errors.js';

function entry() {
  return {
    id: 'entry-1', leagueTeamId: 'team-1', teamNameSnapshot: '历史海港', teamShortNameSnapshot: '海港', teamLogoUrlSnapshot: null,
    competitionParticipants: [{
      id: 'participant-1',
      competition: { competitionType: 'DIVISION_LEAGUE' },
      stageMemberships: [{ stage: { id: 'stage-1', stageCode: 'CHAMPION_A', displayName: '冠军 A 组' } }]
    }]
  };
}

function prisma(overrides: Record<string, unknown> = {}) {
  return {
    seasonEntry: { findFirst: jest.fn(async () => entry()) },
    standingsSnapshot: { findFirst: jest.fn(async () => ({ rows: [{ rank: 2, totalPoints: 13, played: 6, tiePending: false }] })) },
    competitionMatch: { findMany: jest.fn(async () => []) },
    valuationWindow: { findFirst: jest.fn(async () => ({ id: 'window-1' })) },
    ...overrides
  } as never;
}

function workspaceService(database = prisma()) {
  return new LeagueWorkspaceService(database, {
    requireVisible: jest.fn(async () => 'league-1'),
    notFound: () => new LeagueError('LEAGUE_NOT_FOUND', '联赛不存在', 404)
  } as never);
}

describe('LeagueWorkspaceService', () => {
  it('returns the shared 404 before loading a workspace for a deleted league', async () => {
    const database = prisma() as any;
    const visibility = {
      requireVisible: jest.fn(async () => {
        throw new LeagueError('LEAGUE_NOT_FOUND', '联赛不存在', 404);
      })
    };
    const service = new (LeagueWorkspaceService as any)(database, visibility);

    await expect(service.get('user-1', 'league-1', 'season-1'))
      .rejects.toMatchObject({ code: 'LEAGUE_NOT_FOUND', status: 404 });
    expect(database.seasonEntry.findFirst).not.toHaveBeenCalled();
  });

  it('returns snapshot team, division, rank, and enrolled module capabilities', async () => {
    const service = workspaceService();
    const result = await service.get('user-1', 'league-1', 'season-1');

    expect(result.team.name).toBe('历史海港');
    expect(result.division?.displayName).toBe('冠军 A 组');
    expect(result.currentRank).toEqual({ rank: 2, points: 13, played: 6, tiePending: false });
    expect(Object.values(result.capabilities).every(Boolean)).toBe(true);
  });

  it('rejects users without an approved entry', async () => {
    const service = workspaceService(prisma({ seasonEntry: { findFirst: jest.fn(async () => null) } }));
    await expect(service.get('user-1', 'league-1', 'season-1')).rejects.toMatchObject({ status: 403 });
  });

  it('returns explicit empty states when no division data or match exists', async () => {
    const value = entry();
    value.competitionParticipants[0]!.stageMemberships = [];
    const service = workspaceService(prisma({ seasonEntry: { findFirst: jest.fn(async () => value) } }));
    const result = await service.get('user-1', 'league-1', 'season-1');
    expect(result.division).toBeNull();
    expect(result.currentRank).toBeNull();
    expect(result.nextMatch).toBeNull();
    expect(result.capabilities.canViewStandings).toBe(false);
  });

  it('uses the division participant when the same season entry also joins a cup', async () => {
    const value = entry();
    value.competitionParticipants.unshift({
      id: 'cup-participant',
      competition: { competitionType: 'GROUP_KNOCKOUT_CUP' },
      stageMemberships: [{ stage: { id: 'cup-group', stageCode: 'GROUP_A', displayName: 'A 组' } }]
    });
    const service = workspaceService(prisma({ seasonEntry: { findFirst: jest.fn(async () => value) } }));

    const result = await service.get('user-1', 'league-1', 'season-1');

    expect(result.division).toEqual({ stageId: 'stage-1', stageCode: 'CHAMPION_A', displayName: '冠军 A 组' });
  });

  it('does not expose valuation management when the season has no valuation window', async () => {
    const service = workspaceService(prisma({ valuationWindow: { findFirst: jest.fn(async () => null) } }));
    const result = await service.get('user-1', 'league-1', 'season-1');
    expect(result.capabilities.canManageValuations).toBe(false);
  });

  it('selects the earliest planned unfinished match then round and returns the opponent', async () => {
    const match = (id: string, plannedAt: Date | null, roundNumber: number, matchNumber: number) => ({
      id, plannedAt, roundNumber, matchNumber, homeParticipantId: 'participant-1', awayParticipantId: `opponent-${id}`,
      homeParticipant: { displayNameSnapshot: '历史海港' }, awayParticipant: { displayNameSnapshot: `对手${id}` }
    });
    const service = workspaceService(prisma({
      competitionMatch: { findMany: jest.fn(async () => [
        match('late', new Date('2026-11-02T10:00:00Z'), 2, 2),
        match('unplanned', null, 1, 1),
        match('early', new Date('2026-11-01T10:00:00Z'), 3, 3)
      ]) }
    }));
    const result = await service.get('user-1', 'league-1', 'season-1');
    expect(result.nextMatch).toMatchObject({ id: 'early', opponentName: '对手early', side: 'HOME' });
  });
});
