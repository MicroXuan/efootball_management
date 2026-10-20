import { jest } from '@jest/globals';
import { PlayerMarketAccessService } from './player-market-access.service.js';
import { PlayerMarketQueryService, forcedQueuePositions, resolvePlayerMarketAction } from './player-market-query.service.js';

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
  it('shows a new pending application after an older rejection in player detail', async () => {
    const application = {
      id: 'new-pending', leagueId: 'league-1', seasonId: 'season-1', footballPlayerId: 'player-1',
      applicantLeagueTeamId: 'team-1', transferWindowId: null, forcedOfferWindowId: 'forced-1', type: 'FORCED_TRANSFER',
      applicantLeagueTeam: { id: 'team-1', teamNumber: 1, name: '我的队', logoUrl: null, ownerAlias: '我' },
      sourceLeagueTeam: null, footballPlayer: { nameZh: '球员甲', nameEn: null, shortName: null },
      playerCard: { id: 'card-1', cardName: '精选', imageUrl: null, position: 'CF', overallRating: 90, autoBuilds: [] },
      ownershipId: 'own-1', ownershipVersionSnapshot: 1, amountMinor: 500,
      valuationMinorSnapshot: 300, valuationVersionSnapshot: 1, status: 'PENDING',
      firstValidSubmittedAt: now, lastSubmittedAt: now, reviewedAt: null, reviewReason: null, version: 1, events: []
    };
    const prisma = {
      footballPlayer: { findFirst: jest.fn(async () => ({ id: 'player-1', nameEn: 'Player One' })) },
      leagueTeam: { findUnique: jest.fn(async () => ({ salaryCapMinor: 1000 })) },
      leaguePlayerOwnership: { aggregate: jest.fn(async () => ({ _sum: { salaryMinor: 300 } })) },
      playerAcquisitionApplication: { findFirst: jest.fn(async () => application) }
    };
    const access = { requireParticipant: jest.fn(async () => ({ leagueTeamId: 'team-1' })) };
    const service = new PlayerMarketQueryService(prisma as never, access as never, () => now);
    Object.assign(service, {
      marketPlayers: jest.fn(async () => ({ items: [{ playerId: 'player-1', currentOwner: { teamId: 'team-2' }, salary: { salaryMinor: 400 } }], activeTransferWindowId: null, activeForcedOfferWindowId: 'forced-1' })),
      listApplications: jest.fn(async () => ({ items: [{ id: 'old-rejected', applicantTeam: { teamId: 'team-1' }, status: 'REJECTED' }], nextCursor: null }))
    });

    const result = await service.detail('user-1', 'league-1', 'player-1', 'season-1');

    expect(result.myApplication).toMatchObject({ id: 'new-pending', status: 'PENDING' });
    expect(result.publicApplications).toEqual([expect.objectContaining({ id: 'old-rejected' })]);
    expect(result.salaryImpact).toEqual({ currentSalaryMinor: 300, salaryCapMinor: 1000, projectedSalaryMinor: 700, overCapMinor: 0 });
    expect(prisma.leaguePlayerOwnership.aggregate).toHaveBeenCalledTimes(1);
    expect(prisma.playerAcquisitionApplication.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ applicantLeagueTeamId: 'team-1', status: { in: ['PENDING', 'REQUOTE_REQUIRED'] } })
    }));
  });

  it('ranks pending forced bids across periods by first submission, not page order', () => {
    const rows = [
      { id: 'later', footballPlayerId: 'player-1', ownershipId: 'own-1', ownershipVersionSnapshot: 3, firstValidSubmittedAt: new Date(now.getTime() + 1000) },
      { id: 'earlier', footballPlayerId: 'player-1', ownershipId: 'own-1', ownershipVersionSnapshot: 3, firstValidSubmittedAt: now },
      { id: 'other-owner', footballPlayerId: 'player-1', ownershipId: 'own-2', ownershipVersionSnapshot: 1, firstValidSubmittedAt: now }
    ];
    expect(Object.fromEntries(forcedQueuePositions(rows))).toEqual({ earlier: 1, later: 2, 'other-owner': 1 });
  });
  it('uses the requested league rule and leaves a player without a stored build unquoted', async () => {
    const players = ['built', 'unbuilt'].map((id) => ({
      id, nameZh: id, nameEn: null, shortName: null, nationality: null, club: null, clubZh: null,
      createdAt: now, bestCard: {
        playerCard: { id: `card-${id}`, cardName: id, imageUrl: null, position: 'CF', overallRating: 90, attributes: null },
        autoBuild: id === 'built' ? { maxOverall: 95, allocationJson: {}, algorithmVersion: 'v1' } : { maxOverall: 95, allocationJson: null, algorithmVersion: 'v1' }
      }
    }));
    const ruleQuery = jest.fn(async ({ where }: { where: { leagueId: string } }) => ({
      id: `rule-${where.leagueId}`, version: 1, effectiveAt: now,
      tiers: [{ minOverall: 90, maxOverall: 99, salaryMinor: where.leagueId === 'league-a' ? 500 : 800 }]
    }));
    const prisma = {
      footballPlayer: { findMany: jest.fn(async () => players) },
      leaguePlayerOwnership: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
      leaguePlayerValuation: { findMany: jest.fn(async () => []) },
      leagueSalaryRuleVersion: { findFirst: ruleQuery },
      transferWindow: { findFirst: jest.fn(async () => null) },
      forcedOfferWindow: { findFirst: jest.fn(async () => null) }
    };
    const access = { requireParticipant: jest.fn(async () => ({ leagueTeamId: 'team-1', rosterStatus: 'COMPLIANT' })) };
    const service = new PlayerMarketQueryService(prisma as never, access as never, () => now);
    const query = { seasonId: 'season-1', ownership: 'ALL' as const, limit: 30 };
    const first = await service.listMarket('user-1', 'league-a', query);
    const second = await service.listMarket('user-1', 'league-b', query);
    expect(first.items[0]?.salary).toMatchObject({ kind: 'PROJECTED', salaryMinor: 500, salaryRuleVersionId: 'rule-league-a' });
    expect(second.items[0]?.salary).toMatchObject({ kind: 'PROJECTED', salaryMinor: 800, salaryRuleVersionId: 'rule-league-b' });
    expect(first.items[1]?.salary).toMatchObject({ kind: 'UNAVAILABLE', salaryMinor: null, unavailableReason: 'AUTO_BUILD_MISSING' });
    expect(ruleQuery).toHaveBeenCalledTimes(2);
  });

  it.each([
    { label: 'over cap', ownerTeamId: 'team-2', salaryMinor: 250, cap: 500, expected: { projectedSalaryMinor: 650, overCapMinor: 150 } },
    { label: 'unknown cap', ownerTeamId: 'team-2', salaryMinor: 250, cap: null, expected: { projectedSalaryMinor: 650, overCapMinor: null } },
    { label: 'own player', ownerTeamId: 'team-1', salaryMinor: 250, cap: 500, expected: { projectedSalaryMinor: null, overCapMinor: null } },
    { label: 'unquoted', ownerTeamId: null, salaryMinor: null, cap: 500, expected: { projectedSalaryMinor: null, overCapMinor: null } }
  ])('calculates detail impact for $label', async ({ ownerTeamId, salaryMinor, cap, expected }) => {
    const prisma = {
      footballPlayer: { findFirst: jest.fn(async () => ({ id: 'player-1', nameEn: null })) },
      leagueTeam: { findUnique: jest.fn(async () => ({ salaryCapMinor: cap })) },
      leaguePlayerOwnership: { aggregate: jest.fn(async () => ({ _sum: { salaryMinor: 400 } })) },
      playerAcquisitionApplication: { findFirst: jest.fn(async () => null) }
    };
    const access = { requireParticipant: jest.fn(async () => ({ leagueTeamId: 'team-1' })) };
    const service = new PlayerMarketQueryService(prisma as never, access as never, () => now);
    Object.assign(service, {
      marketPlayers: jest.fn(async () => ({ items: [{ currentOwner: ownerTeamId ? { teamId: ownerTeamId } : null, salary: { salaryMinor } }], activeTransferWindowId: null, activeForcedOfferWindowId: null })),
      listApplications: jest.fn(async () => ({ items: [] }))
    });
    const result = await service.detail('user-1', 'league-1', 'player-1', 'season-1');
    expect(result.salaryImpact).toMatchObject({ currentSalaryMinor: 400, salaryCapMinor: cap, ...expected });
    expect(prisma.leaguePlayerOwnership.aggregate).toHaveBeenCalledTimes(1);
  });
  it('maps free, own, and rival players without exposing private owner fields', async () => {
    const players = ['free', 'mine', 'rival'].map((id) => ({
      id: `player-${id}`, nameZh: id, nameEn: null, shortName: null, nationality: '中国', club: 'Test FC', clubZh: '测试队',
      bestCard: { playerCardId: `card-${id}`, playerCard: { id: `card-${id}`, cardName: '精选', imageUrl: null, position: 'CF', overallRating: 90,
        attributes: id === 'free' ? { attributesJson: { age: 39, height: 170, weight: 67, foot: 'LEFT' } } : null }, autoBuild: { maxOverall: 95, algorithmVersion: 'v1', allocationJson: {} } }
    }));
    const prisma = {
      footballPlayer: { findMany: jest.fn(async () => players) },
      leaguePlayerOwnership: {
        findMany: jest.fn(async () => [
          { id: 'own-mine', footballPlayerId: 'player-mine', leagueTeamId: 'team-1', currentPlayerCardId: 'card-mine', maxOverallSnapshot: 95, salaryRuleVersionId: 'old-rule', salaryMinor: 300, version: 1, acquisitionType: 'NORMAL', acquisitionSeasonId: null, leagueTeam: { id: 'team-1', teamNumber: 1, name: '我的队', logoUrl: null, ownerAlias: '我' } },
          { id: 'own-rival', footballPlayerId: 'player-rival', leagueTeamId: 'team-2', currentPlayerCardId: 'card-rival', maxOverallSnapshot: 95, salaryRuleVersionId: 'old-rule', salaryMinor: 400, version: 2, acquisitionType: 'FORCED_TRANSFER', acquisitionSeasonId: 'season-1', leagueTeam: { id: 'team-2', teamNumber: 2, name: '对手队', logoUrl: '/logo.png', ownerAlias: '对手' } }
        ]),
        count: jest.fn(async () => 3)
      },
      leaguePlayerValuation: { findMany: jest.fn(async () => players.map((player, index) => ({ footballPlayerId: player.id, currentValueMinor: 500 + index, version: 1 }))) },
      leagueSalaryRuleVersion: { findFirst: jest.fn(async () => ({ id: 'new-rule', version: 2, effectiveAt: now, tiers: [{ minOverall: 90, maxOverall: 99, salaryMinor: 600 }] })) },
      transferWindow: { findFirst: jest.fn(async () => ({ id: 'window-1', allowBuy: true, startsAt: new Date(now.getTime() - 1000), endsAt: new Date(now.getTime() + 1000) })) },
      forcedOfferWindow: { findFirst: jest.fn(async () => ({ id: 'forced-1' })) },
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
    expect(result.activeForcedOfferWindowId).toBe('forced-1');
    expect(result.items[2]?.currentOwner).toEqual({ teamId: 'team-2', teamNumber: 2, name: '对手队', logoUrl: '/logo.png', ownerAlias: '对手' });
    expect(result.items[0]?.clubZh).toBe('测试队');
    expect(result.items[0]?.nationalityZh).toBe('中国');
    expect(result.items[0]).toMatchObject({ age: 39, heightCm: 170, weightKg: 67, preferredFoot: 'LEFT' });
    expect(result.items[1]).toMatchObject({ age: null, heightCm: null, weightKg: null, preferredFoot: null });
    expect(result.items.map((item) => item.salary.kind)).toEqual(['PROJECTED', 'ACTUAL', 'ACTUAL']);
    expect(result.items.map((item) => item.salary.salaryMinor)).toEqual([600, 300, 400]);
    expect(result.items[2]?.salary).toMatchObject({
      basisOverall: 95, salaryRuleVersionId: 'old-rule', currentTier: { salaryMinor: 600, salaryRuleVersionId: 'new-rule' }
    });
    expect(result.items.map((item) => item.card?.salaryMinor)).toEqual([600, 300, 400]);
    prisma.leaguePlayerValuation.findMany.mockResolvedValueOnce(players.slice(0, 2).map((player, index) => ({
      footballPlayerId: player.id, currentValueMinor: 500 + index, version: 1
    })));
    const withoutRivalValue = await service.listMarket('user-1', 'league-1', {
      seasonId: 'season-1', ownership: 'ALL', limit: 30
    });
    expect(withoutRivalValue.items[2]).toMatchObject({
      officialValueMinor: null, action: 'DISABLED', disabledReason: 'OFFICIAL_VALUE_REQUIRED'
    });
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
      forcedOfferWindow: { findFirst: jest.fn(async () => null) },
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
        },
        salary: { kind: 'UNAVAILABLE', salaryMinor: null, unavailableReason: 'AUTO_BUILD_MISSING' }
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
      attributes: { attributesJson: { age: 99, sourceMetadata: { maxLevel: ' 0 ' } } }, autoBuilds: []
    };
    const ownedCard = {
      id: 'card-owned', playerId: 'player-owned', externalId: 'card-owned', cardName: '当前持有卡',
      imageUrl: 'https://img.pesdata.net/owned.webp', position: 'CMF', overallRating: 82,
      cardType: 'STANDARD', attributes: { attributesJson: { age: 24, heightCm: 183, weightKg: 76, preferredFoot: 'LEFT' } },
      autoBuilds: [{ maxOverall: 84 }]
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
      forcedOfferWindow: { findFirst: jest.fn(async () => null) },
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
        age: 24, heightCm: 183, weightKg: 76, preferredFoot: 'LEFT',
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
      transferWindow: { findFirst: jest.fn(async () => null) },
      forcedOfferWindow: { findFirst: jest.fn(async () => null) }
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
      forcedOfferWindow: { findFirst: jest.fn(async () => null) },
      playerAcquisitionApplication: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) }
    };
    Object.assign(prisma, {
      leagueTeam: { findUnique: jest.fn(async () => ({ salaryCapMinor: null })) }
    });
    Object.assign(prisma.leaguePlayerOwnership, {
      aggregate: jest.fn(async () => ({ _sum: { salaryMinor: null } }))
    });
    const access = { requireParticipant: jest.fn(async () => ({
      seasonEntryId: 'entry-1', leagueId: 'league-1', seasonId: 'season-1', leagueTeamId: 'team-1',
      teamNumber: 1, teamName: '我的队', teamLogoUrl: null, ownerAlias: '我', rosterStatus: 'COMPLIANT'
    })) };
    const service = new PlayerMarketQueryService(prisma as never, access as never, () => now);

    await expect(service.detail('user-1', 'league-1', 'player-101', 'season-1'))
      .resolves.toMatchObject({ playerId: 'player-101', playerName: '第 101 名球员', playerEnglishName: null,
        salaryImpact: { currentSalaryMinor: 0, salaryCapMinor: null, projectedSalaryMinor: null, overCapMinor: null } });
    expect(prisma.footballPlayer.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'player-101', publishedAt: { not: null } }
    }));
  });

  it('returns explicit disabled reasons for capacity, window, compliance, missing value, and release restrictions', () => {
    const base = { ownedByMe: false, rosterCount: 1, rosterStatus: 'COMPLIANT' as const, transferWindowOpen: true, forcedOfferWindowOpen: true, officialValueMinor: 500, releasedByMe: false };
    expect(resolvePlayerMarketAction({ ...base, owned: false, rosterCount: 25 })).toEqual({ action: 'DISABLED', disabledReason: 'ROSTER_CAPACITY_REACHED' });
    expect(resolvePlayerMarketAction({ ...base, owned: false, transferWindowOpen: false })).toEqual({ action: 'DISABLED', disabledReason: 'TRANSFER_WINDOW_CLOSED' });
    expect(resolvePlayerMarketAction({ ...base, owned: true, forcedOfferWindowOpen: false })).toEqual({ action: 'DISABLED', disabledReason: 'FORCED_OFFER_WINDOW_CLOSED' });
    expect(resolvePlayerMarketAction({ ...base, owned: true, transferWindowOpen: false })).toEqual({ action: 'FORCE_SIGN', disabledReason: null });
    const unvalued = { ...base, owned: true, officialValueMinor: null };
    expect(resolvePlayerMarketAction(unvalued)).toEqual({ action: 'DISABLED', disabledReason: 'OFFICIAL_VALUE_REQUIRED' });
    expect(resolvePlayerMarketAction({ ...base, owned: false, rosterStatus: 'OVER_CAP' })).toEqual({ action: 'DISABLED', disabledReason: 'ROSTER_NON_COMPLIANT' });
    expect(resolvePlayerMarketAction({ ...base, owned: false, releasedByMe: true })).toEqual({ action: 'DISABLED', disabledReason: 'RELEASED_BY_TEAM_IN_WINDOW' });
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
