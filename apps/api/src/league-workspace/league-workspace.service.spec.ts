import { describe, expect, it, jest } from '@jest/globals';
import { LeagueWorkspaceService } from './league-workspace.service.js';

function entry() {
  return {
    id: 'entry-1', leagueTeamId: 'team-1', teamNameSnapshot: '历史海港', teamShortNameSnapshot: '海港', teamLogoUrlSnapshot: null,
    competitionParticipant: {
      id: 'participant-1',
      stageMemberships: [{ stage: { id: 'stage-1', stageCode: 'CHAMPION_A', displayName: '冠军 A 组' } }]
    }
  };
}

function prisma(overrides: Record<string, unknown> = {}) {
  return {
    seasonEntry: { findFirst: jest.fn(async () => entry()) },
    standingsSnapshot: { findFirst: jest.fn(async () => ({ rows: [{ rank: 2, totalPoints: 13, played: 6, tiePending: false }] })) },
    competitionMatch: { findMany: jest.fn(async () => []) },
    ...overrides
  } as never;
}

describe('LeagueWorkspaceService', () => {
  it('returns snapshot team, division, rank, and enrolled module capabilities', async () => {
    const service = new LeagueWorkspaceService(prisma());
    const result = await service.get('user-1', 'league-1', 'season-1');

    expect(result.team.name).toBe('历史海港');
    expect(result.division?.displayName).toBe('冠军 A 组');
    expect(result.currentRank).toEqual({ rank: 2, points: 13, played: 6, tiePending: false });
    expect(Object.values(result.capabilities).every(Boolean)).toBe(true);
  });

  it('rejects users without an approved entry', async () => {
    const service = new LeagueWorkspaceService(prisma({ seasonEntry: { findFirst: jest.fn(async () => null) } }));
    await expect(service.get('user-1', 'league-1', 'season-1')).rejects.toMatchObject({ status: 403 });
  });

  it('returns explicit empty states when no division data or match exists', async () => {
    const value = entry();
    value.competitionParticipant.stageMemberships = [];
    const service = new LeagueWorkspaceService(prisma({ seasonEntry: { findFirst: jest.fn(async () => value) } }));
    const result = await service.get('user-1', 'league-1', 'season-1');
    expect(result.division).toBeNull();
    expect(result.currentRank).toBeNull();
    expect(result.nextMatch).toBeNull();
  });

  it('selects the earliest planned unfinished match then round and returns the opponent', async () => {
    const match = (id: string, plannedAt: Date | null, roundNumber: number, matchNumber: number) => ({
      id, plannedAt, roundNumber, matchNumber, homeParticipantId: 'participant-1', awayParticipantId: `opponent-${id}`,
      homeParticipant: { displayNameSnapshot: '历史海港' }, awayParticipant: { displayNameSnapshot: `对手${id}` }
    });
    const service = new LeagueWorkspaceService(prisma({
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
