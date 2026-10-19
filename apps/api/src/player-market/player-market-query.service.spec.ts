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
      where: { AND: expect.arrayContaining([expect.objectContaining({ OR: expect.arrayContaining([
        { club: { contains: '测试' } },
        { clubZh: { contains: '测试' } },
        { clubEn: { contains: '测试' } }
      ]) })]) }
    }));
  });

  it('falls back to an active player card when the saved best-card selection is missing', async () => {
    const player = {
      id: 'player-yaya', nameZh: '亚亚·图雷', nameEn: 'Yaya Touré', shortName: null,
      nationality: "Côte d'Ivoire", club: 'FC Barcelona', createdAt: now, bestCard: null,
      cards: [{
        id: 'card-yaya', playerId: 'player-yaya', externalId: '88046292727298', cardName: 'European Clubs Selection Midfielders',
        imageUrl: 'https://img.pesdata.net/images/playerCard/88046292727298_l.webp', position: 'DMF',
        overallRating: 86, cardType: 'EPIC', cardPack: { releaseDate: new Date('2026-10-19T00:00:00.000Z') },
        attributes: { attributesJson: { sourceMetadata: { maxLevel: 64 } } }, autoBuilds: []
      }]
    };
    const prisma = {
      footballPlayer: { findMany: jest.fn(async () => [player]) },
      playerCard: { findMany: jest.fn(async () => player.cards) },
      leaguePlayerOwnership: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
      leaguePlayerValuation: { findMany: jest.fn(async () => []) },
      leagueSalaryRuleVersion: { findFirst: jest.fn(async () => null) },
      transferWindow: { findFirst: jest.fn(async () => null) },
      playerReleaseRestriction: { findMany: jest.fn(async () => []) }
    };
    const access = { requireParticipant: jest.fn(async () => ({
      leagueTeamId: 'team-1', rosterStatus: 'COMPLIANT'
    })) };
    const service = new PlayerMarketQueryService(prisma as never, access as never, () => now);

    await expect(service.listMarket('user-1', 'league-1', {
      seasonId: 'season-1', ownership: 'ALL', limit: 30
    })).resolves.toMatchObject({
      items: [{
        playerId: 'player-yaya',
        card: {
          playerCardId: 'card-yaya',
          imageUrl: 'https://img.pesdata.net/images/playerCard/88046292727298_l.webp',
          position: 'DMF',
          maxOverall: 99
        }
      }]
    });
    expect(prisma.playerCard.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'ACTIVE', publishedAt: { not: null } })
    }));
  });

  it('uses fixed zero-level fallbacks but never replaces an owned current card', async () => {
    const fallback = {
      id: 'card-fixed', playerId: 'player-owned', externalId: 'card-fixed', cardName: '固定能力卡',
      imageUrl: 'https://img.pesdata.net/fixed.webp', position: 'DMF', overallRating: 95,
      cardType: 'EPIC', cardPack: { releaseDate: new Date('2026-10-19T00:00:00.000Z') },
      attributes: { attributesJson: { sourceMetadata: { maxLevel: ' 0 ' } } }, autoBuilds: []
    };
    const ownedCard = {
      id: 'card-owned', playerId: 'player-owned', externalId: 'card-owned', cardName: '当前持有卡',
      imageUrl: 'https://img.pesdata.net/owned.webp', position: 'CMF', overallRating: 82,
      cardType: 'STANDARD', autoBuilds: [{ maxOverall: 84 }]
    };
    const player = {
      id: 'player-owned', nameZh: '持有球员', nameEn: null, shortName: null,
      nationality: null, club: null, createdAt: now, bestCard: null
    };
    const prisma = {
      footballPlayer: { findMany: jest.fn(async () => [player]) },
      playerCard: { findMany: jest.fn(async () => [fallback]) },
      leaguePlayerOwnership: {
        findMany: jest.fn(async () => [{
          id: 'ownership-1', footballPlayerId: player.id, leagueTeamId: 'team-1',
          currentPlayerCardId: ownedCard.id, currentPlayerCard: ownedCard,
          maxOverallSnapshot: 84, salaryMinor: 300, version: 1,
          acquisitionType: 'NORMAL', acquisitionSeasonId: 'season-1',
          leagueTeam: { id: 'team-1', teamNumber: 1, name: '我的队', logoUrl: null, ownerAlias: '我' }
        }]),
        count: jest.fn(async () => 1)
      },
      leaguePlayerValuation: { findMany: jest.fn(async () => []) },
      leagueSalaryRuleVersion: { findFirst: jest.fn(async () => null) },
      transferWindow: { findFirst: jest.fn(async () => null) },
      playerReleaseRestriction: { findMany: jest.fn(async () => []) }
    };
    const access = { requireParticipant: jest.fn(async () => ({
      leagueTeamId: 'team-1', rosterStatus: 'COMPLIANT'
    })) };
    const service = new PlayerMarketQueryService(prisma as never, access as never, () => now);

    await expect(service.listMarket('user-1', 'league-1', {
      seasonId: 'season-1', ownership: 'ALL', limit: 30
    })).resolves.toMatchObject({
      items: [{
        playerId: player.id,
        card: {
          playerCardId: ownedCard.id,
          imageUrl: ownedCard.imageUrl,
          position: 'CMF',
          maxOverall: 84
        }
      }]
    });
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

  it('expires closed-window applications idempotently before returning the W2 queue', async () => {
    const rootFindMany = jest.fn<() => Promise<Array<{ id: string; footballPlayerId: string }>>>(async () => [])
      .mockResolvedValueOnce([{ id: 'app-w1', footballPlayerId: 'player-1' }]);
    const tx = {
      playerAcquisitionApplication: {
        findMany: jest.fn(async () => [{ id: 'app-w1', applicantLeagueTeamId: 'team-1', sourceLeagueTeamId: null,
          status: 'PENDING', amountMinor: 500 }]),
        update: jest.fn(async () => ({ id: 'app-w1', status: 'EXPIRED' }))
      },
      playerAcquisitionApplicationEvent: { create: jest.fn(async () => ({ id: 'event-expired' })) }
    };
    const prisma = {
      playerAcquisitionApplication: { findMany: rootFindMany },
      $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx))
    };
    const access = { requireParticipant: jest.fn(async () => ({ leagueTeamId: 'team-1', rosterStatus: 'COMPLIANT' })) };
    const locks = { lockSeason: jest.fn(async () => undefined), lockPlayer: jest.fn(async () => undefined),
      lockTeams: jest.fn(async () => undefined), lockApplicationsForPlayer: jest.fn(async () => undefined) };
    const service = new PlayerMarketQueryService(prisma as never, access as never, () => now, undefined, locks as never);

    await expect(service.listApplications('user-1', 'league-1', {
      seasonId: 'season-1', scope: 'PUBLIC', limit: 30
    })).resolves.toEqual({ items: [], nextCursor: null });
    await expect(service.listApplications('user-1', 'league-1', {
      seasonId: 'season-1', scope: 'PUBLIC', limit: 30
    })).resolves.toEqual({ items: [], nextCursor: null });
    expect(tx.playerAcquisitionApplication.update).toHaveBeenCalledWith({ where: { id: 'app-w1' }, data: {
      status: 'EXPIRED', reviewedAt: now, reviewReason: 'TRANSFER_WINDOW_CLOSED', version: { increment: 1 }
    } });
    expect(tx.playerAcquisitionApplicationEvent.create).toHaveBeenCalledTimes(1);
  });

  it('uses a timestamp plus id cursor for stable pagination', () => {
    const cursor = PlayerMarketQueryService.encodeCursor(now, 'player-2');
    expect(PlayerMarketQueryService.decodeCursor(cursor)).toEqual({ createdAt: now, id: 'player-2' });
  });
});
