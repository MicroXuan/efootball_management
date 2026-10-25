import { jest } from '@jest/globals';
import { SeasonPlayingRosterService } from './season-playing-roster.service.js';

describe('SeasonPlayingRosterService', () => {
  it('captures active ownerships of approved teams once at season start', async () => {
    let capturedAt: Date | null = null;
    const transaction = {
      leagueSeason: {
        findUnique: jest.fn(async () => ({ leagueId: 'league-1', playingRosterCapturedAt: capturedAt })),
        update: jest.fn(async () => { capturedAt = new Date(); return {}; })
      },
      seasonEntry: { findMany: jest.fn(async () => [{ leagueTeamId: 'team-1' }]) },
      leaguePlayerOwnership: { findMany: jest.fn(async () => [{
        leagueTeamId: 'team-1', footballPlayerId: 'player-1', currentPlayerCardId: 'card-1'
      }]) },
      seasonPlayingRosterEntry: { createMany: jest.fn(async () => ({ count: 1 })) }
    };
    const service = new SeasonPlayingRosterService({} as never);

    await service.capture(transaction as never, 'season-1');
    await service.capture(transaction as never, 'season-1');

    expect(transaction.seasonEntry.findMany).toHaveBeenCalledWith({
      where: { seasonId: 'season-1', status: 'APPROVED', leagueTeam: { status: 'ACTIVE' } },
      select: { leagueTeamId: true }
    });
    expect(transaction.leaguePlayerOwnership.findMany).toHaveBeenCalledWith({
      where: { leagueId: 'league-1', leagueTeamId: { in: ['team-1'] }, status: 'ACTIVE' },
      select: { leagueTeamId: true, footballPlayerId: true, currentPlayerCardId: true }
    });
    expect(transaction.seasonPlayingRosterEntry.createMany).toHaveBeenCalledTimes(1);
    expect(transaction.seasonPlayingRosterEntry.createMany).toHaveBeenCalledWith({ data: [{
      seasonId: 'season-1', leagueTeamId: 'team-1', footballPlayerId: 'player-1', playerCardId: 'card-1'
    }] });
  });

  it('reads the fixed playing roster after ownership changes and rejects seasons without a snapshot', async () => {
    const prisma = {
      leagueSeason: { findUnique: jest.fn(async () => ({
        leagueId: 'league-1', status: 'IN_PROGRESS', league: { isDeleted: false },
        playingRosterCapturedAt: new Date('2026-10-01T00:00:00.000Z')
      })) },
      seasonEntry: { findFirst: jest.fn(async () => ({ id: 'entry-1' })) },
      seasonPlayingRosterEntry: { findMany: jest.fn(async () => [{
        leagueTeamId: 'original-team', footballPlayerId: 'player-1', playerCardId: 'card-1',
        footballPlayer: { nameZh: '球员甲', nameEn: null },
        playerCard: { cardName: '常规卡', position: 'CF', overallRating: 90 }
      }]) },
      leaguePlayerOwnership: { findMany: jest.fn() }
    };
    const service = new SeasonPlayingRosterService(prisma as never);

    expect((await service.list('user-1', 'season-1')).items[0]).toMatchObject({
      leagueTeamId: 'original-team', footballPlayerId: 'player-1'
    });
    expect(prisma.leaguePlayerOwnership.findMany).not.toHaveBeenCalled();

    prisma.leagueSeason.findUnique.mockImplementationOnce(async () => ({
      leagueId: 'league-1', status: 'IN_PROGRESS', league: { isDeleted: false }, playingRosterCapturedAt: null as never
    }));
    await expect(service.list('user-1', 'season-legacy')).rejects.toMatchObject({ code: 'PLAYING_ROSTER_NOT_CAPTURED' });
    prisma.seasonEntry.findFirst.mockResolvedValueOnce(null as never);
    await expect(service.list('outsider', 'season-1')).rejects.toMatchObject({ code: 'PLAYING_ROSTER_ACCESS_DENIED' });
  });
});
