import { jest } from '@jest/globals';
import { PlayerMarketAccessService } from './player-market-access.service.js';
import { PlayerMarketQueryService, resolvePlayerMarketAction } from './player-market-query.service.js';

const now = new Date('2026-10-14T12:00:00.000Z');

describe('PlayerMarketAccessService', () => {
  it('accepts only approved participants in the requested league season', async () => {
    const prisma = {
      seasonEntry: { findFirst: jest.fn(async () => ({
        id: 'entry-1', seasonId: 'season-1', leagueTeamId: 'team-1',
        leagueTeam: { id: 'team-1', leagueId: 'league-1', ownerUserId: 'user-1', status: 'ACTIVE', rosterStatus: 'COMPLIANT' }
      })) }
    };
    const visibility = { requireVisible: jest.fn(async () => 'league-1') };
    const service = new PlayerMarketAccessService(prisma as never, visibility as never);

    await expect(service.requireParticipant('user-1', 'league-1', 'season-1'))
      .resolves.toMatchObject({ leagueTeamId: 'team-1', rosterStatus: 'COMPLIANT' });
    expect(prisma.seasonEntry.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerUserId: 'user-1', seasonId: 'season-1', status: 'APPROVED' })
    }));
  });

  it('rejects cross-league seasons, outsiders, and archived teams', async () => {
    const prisma = { seasonEntry: { findFirst: jest.fn(async () => null) } };
    const visibility = { requireVisible: jest.fn(async () => 'other-league') };
    const service = new PlayerMarketAccessService(prisma as never, visibility as never);
    await expect(service.requireParticipant('user-1', 'league-1', 'season-1'))
      .rejects.toMatchObject({ code: 'PLAYER_MARKET_SCOPE_MISMATCH' });

    visibility.requireVisible.mockResolvedValueOnce('league-1');
    await expect(service.requireParticipant('user-1', 'league-1', 'season-1'))
      .rejects.toMatchObject({ code: 'LEAGUE_PARTICIPANT_REQUIRED' });
  });
});

describe('PlayerMarketQueryService', () => {
  it('maps free, own, and rival players without exposing private owner fields', async () => {
    const players = ['free', 'mine', 'rival'].map((id) => ({
      id: `player-${id}`, nameZh: id, nameEn: null, shortName: null, nationality: '中国', club: '测试队',
      bestCard: { playerCardId: `card-${id}`, playerCard: { id: `card-${id}`, cardName: '精选', imageUrl: null, position: 'CF', overallRating: 90 }, autoBuild: { maxOverall: 95 } }
    }));
    const prisma = {
      footballPlayer: { findMany: jest.fn(async () => players) },
      leaguePlayerOwnership: {
        findMany: jest.fn(async () => [
          { id: 'own-mine', footballPlayerId: 'player-mine', leagueTeamId: 'team-1', currentPlayerCardId: 'card-mine', salaryMinor: 300, version: 1, acquisitionType: 'NORMAL', acquisitionSeasonId: null, leagueTeam: { id: 'team-1', teamNumber: 1, name: '我的队', logoUrl: null, ownerAlias: '我' } },
          { id: 'own-rival', footballPlayerId: 'player-rival', leagueTeamId: 'team-2', currentPlayerCardId: 'card-rival', salaryMinor: 400, version: 2, acquisitionType: 'FORCED_TRANSFER', acquisitionSeasonId: 'season-1', leagueTeam: { id: 'team-2', teamNumber: 2, name: '对手队', logoUrl: '/logo.png', ownerAlias: '对手' } }
        ]),
        count: jest.fn(async () => 3)
      },
      leaguePlayerValuation: { findMany: jest.fn(async () => players.map((player, index) => ({ footballPlayerId: player.id, currentValueMinor: 500 + index, version: 1 }))) },
      leagueSalaryRuleVersion: { findFirst: jest.fn(async () => null) },
      transferWindow: { findFirst: jest.fn(async () => ({ id: 'window-1', allowBuy: true, startsAt: new Date(now.getTime() - 1000), endsAt: new Date(now.getTime() + 1000) })) },
      playerReleaseRestriction: { findMany: jest.fn(async () => []) },
      playerAcquisitionApplication: { findMany: jest.fn(async () => []) }
    };
    const access = { requireParticipant: jest.fn(async () => ({
      seasonEntryId: 'entry-1', leagueId: 'league-1', seasonId: 'season-1', leagueTeamId: 'team-1',
      teamNumber: 1, teamName: '我的队', teamLogoUrl: null, ownerAlias: '我', rosterStatus: 'COMPLIANT'
    })) };
    const service = new PlayerMarketQueryService(prisma as never, access as never, () => now);

    const result = await service.listMarket('user-1', 'league-1', {
      seasonId: 'season-1', keyword: '  测试  ', ownership: 'ALL', limit: 30
    });

    expect(result.items.map(({ action }) => action)).toEqual(['APPLY', 'OWNED_BY_ME', 'FORCE_SIGN']);
    expect(result.activeTransferWindowId).toBe('window-1');
    expect(result.items[2]?.currentOwner).toEqual({ teamId: 'team-2', teamNumber: 2, name: '对手队', logoUrl: '/logo.png', ownerAlias: '对手' });
    expect(prisma.footballPlayer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { AND: expect.arrayContaining([expect.objectContaining({ OR: expect.any(Array) })]) }
    }));
  });

  it('applies ownership filtering before cursor pagination', async () => {
    const prisma = {
      footballPlayer: { findMany: jest.fn(async () => []) },
      leaguePlayerOwnership: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
      leaguePlayerValuation: { findMany: jest.fn(async () => []) },
      leagueSalaryRuleVersion: { findFirst: jest.fn(async () => null) },
      transferWindow: { findFirst: jest.fn(async () => null) }
    };
    const access = { requireParticipant: jest.fn(async () => ({
      leagueTeamId: 'team-1', rosterStatus: 'COMPLIANT'
    })) };
    const service = new PlayerMarketQueryService(prisma as never, access as never, () => now);

    await service.listMarket('user-1', 'league-1', {
      seasonId: 'season-1', ownership: 'FREE', limit: 30
    });

    expect(prisma.footballPlayer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { AND: expect.arrayContaining([
        { leagueOwnerships: { none: { leagueId: 'league-1', status: 'ACTIVE' } } }
      ]) }
    }));
  });

  it('loads a published player detail directly instead of searching only the first market page', async () => {
    const player = {
      id: 'player-101', nameZh: '第 101 名球员', nameEn: null, shortName: null,
      nationality: '中国', club: '测试队', createdAt: now,
      bestCard: { playerCardId: 'card-101', playerCard: { id: 'card-101', cardName: '精选', imageUrl: null, position: 'CF', overallRating: 90 }, autoBuild: { maxOverall: 95 } }
    };
    const prisma = {
      footballPlayer: {
        findFirst: jest.fn(async () => player),
        findMany: jest.fn(async () => { throw new Error('detail must not scan a limited market page'); })
      },
      leaguePlayerOwnership: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
      leaguePlayerValuation: { findMany: jest.fn(async () => []) },
      leagueSalaryRuleVersion: { findFirst: jest.fn(async () => null) },
      transferWindow: { findFirst: jest.fn(async () => null) },
      playerAcquisitionApplication: { findMany: jest.fn(async () => []) }
    };
    const access = { requireParticipant: jest.fn(async () => ({
      seasonEntryId: 'entry-1', leagueId: 'league-1', seasonId: 'season-1', leagueTeamId: 'team-1',
      teamNumber: 1, teamName: '我的队', teamLogoUrl: null, ownerAlias: '我', rosterStatus: 'COMPLIANT'
    })) };
    const service = new PlayerMarketQueryService(prisma as never, access as never, () => now);

    await expect(service.detail('user-1', 'league-1', 'player-101', 'season-1'))
      .resolves.toMatchObject({ playerId: 'player-101', playerName: '第 101 名球员' });
    expect(prisma.footballPlayer.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'player-101', publishedAt: { not: null } }
    }));
  });

  it('returns explicit disabled reasons for capacity, window, compliance, and release restrictions', () => {
    expect(resolvePlayerMarketAction({ ownedByMe: false, owned: false, rosterCount: 25, rosterStatus: 'COMPLIANT', windowOpen: true, releasedByMe: false })).toEqual({ action: 'DISABLED', disabledReason: 'ROSTER_CAPACITY_REACHED' });
    expect(resolvePlayerMarketAction({ ownedByMe: false, owned: false, rosterCount: 1, rosterStatus: 'COMPLIANT', windowOpen: false, releasedByMe: false })).toEqual({ action: 'DISABLED', disabledReason: 'TRANSFER_WINDOW_CLOSED' });
    expect(resolvePlayerMarketAction({ ownedByMe: false, owned: false, rosterCount: 1, rosterStatus: 'OVER_CAP', windowOpen: true, releasedByMe: false })).toEqual({ action: 'DISABLED', disabledReason: 'ROSTER_NON_COMPLIANT' });
    expect(resolvePlayerMarketAction({ ownedByMe: false, owned: false, rosterCount: 1, rosterStatus: 'COMPLIANT', windowOpen: true, releasedByMe: true })).toEqual({ action: 'DISABLED', disabledReason: 'RELEASED_BY_TEAM_IN_WINDOW' });
  });

  it('uses a timestamp plus id cursor for stable pagination', () => {
    const cursor = PlayerMarketQueryService.encodeCursor(now, 'player-2');
    expect(PlayerMarketQueryService.decodeCursor(cursor)).toEqual({ createdAt: now, id: 'player-2' });
  });
});
