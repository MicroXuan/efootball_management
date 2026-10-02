import { jest } from '@jest/globals';
import { TeamAssetsService } from './team-assets.service.js';

const at = new Date('2026-10-02T12:00:00.000Z');

function harness() {
  const team = {
    id: 'team-1', leagueId: 'league-1', ownerUserId: 'user-1', teamNumber: 7,
    name: '海港竞技', logoUrl: null, shellValueMinor: 5000,
    owner: { displayName: '小宣', publicUserNo: '100069' }
  };
  const ownerships = [
    {
      id: 'ownership-1', leagueId: 'league-1', leagueTeamId: 'team-1', footballPlayerId: 'player-1',
      acquiredAt: at, status: 'ACTIVE', salaryMinor: 800,
      footballPlayer: { nameZh: '有效球员', nameEn: null, shortName: null, nationality: '中国', club: '上海海港' },
      currentPlayerCard: { cardName: '精选卡', imageUrl: null, position: 'CF', attributes: { attributesJson: { age: 22, height: 180, at: 91 } } }
    },
    {
      id: 'ownership-2', leagueId: 'league-1', leagueTeamId: 'team-1', footballPlayerId: 'player-2',
      acquiredAt: at, status: 'ACTIVE', salaryMinor: 400,
      footballPlayer: { nameZh: null, nameEn: 'Missing Value', shortName: null, nationality: null, club: null },
      currentPlayerCard: { cardName: '基础卡', imageUrl: null, position: 'CB', attributes: null }
    },
    {
      id: 'ownership-3', leagueId: 'league-1', leagueTeamId: 'team-1', footballPlayerId: 'player-3',
      acquiredAt: at, status: 'DISAPPEARED', salaryMinor: 300,
      footballPlayer: { nameZh: '消失球员', nameEn: null, shortName: null, nationality: null, club: null },
      currentPlayerCard: { cardName: '旧卡', imageUrl: null, position: 'AMF', attributes: null }
    },
    {
      id: 'ownership-4', leagueId: 'league-1', leagueTeamId: 'team-1', footballPlayerId: 'player-4',
      acquiredAt: at, status: 'RETIRED', salaryMinor: 200,
      footballPlayer: { nameZh: '退役球员', nameEn: null, shortName: null, nationality: null, club: null },
      currentPlayerCard: { cardName: '传奇卡', imageUrl: null, position: 'GK', attributes: null }
    }
  ];
  const prisma = {
    leagueTeam: { findUnique: jest.fn(async () => team) },
    leaguePlayerOwnership: { findMany: jest.fn(async () => ownerships) },
    leaguePlayerValuation: { findMany: jest.fn(async () => [
      { footballPlayerId: 'player-1', currentValueMinor: 8000, effectiveAt: at },
      { footballPlayerId: 'player-3', currentValueMinor: 9999, effectiveAt: at }
    ]) },
    seasonEntry: { findFirst: jest.fn<() => Promise<{ id: string } | null>>(async () => ({ id: 'entry-1' })) },
    footballPlayer: { findUnique: jest.fn(async () => ({ id: 'player-1', nameZh: '有效球员', nameEn: null, shortName: null })) },
    playerValuationHistory: { findMany: jest.fn(async () => [{ id: 'history-1', previousValueMinor: null, newValueMinor: 8000, effectiveAt: at }]) }
  };
  return { service: new TeamAssetsService(prisma as never), prisma, ownerships };
}

describe('TeamAssetsService', () => {
  it('aggregates three roster states while valuing and paying only active players', async () => {
    const { service } = harness();
    const result = await service.getTeamAssets('user-1', 'team-1');

    expect(result).toMatchObject({
      teamName: '海港竞技', teamNumber: 7, ownerDisplayName: '小宣', shellValueMinor: 5000,
      activePlayerCount: 2, activeSalaryMinor: 1200, knownPlayerValueMinor: 8000,
      totalKnownValueMinor: 13_000, missingValuationCount: 1, valuationCompleteness: 'INCOMPLETE'
    });
    expect(result.players.map(({ rosterStatus }) => rosterStatus))
      .toEqual(['ACTIVE', 'ACTIVE', 'DISAPPEARED', 'RETIRED']);
    expect(result.players[0]).toMatchObject({
      position: 'CF', nationality: '中国', club: '上海海港', age: 22, heightCm: 180,
      atRating: 91, salaryMinor: 800, currentValueMinor: 8000
    });
    expect(result.players[2]?.currentValueMinor).toBeNull();
  });

  it('rejects a non-owner even when the team exists', async () => {
    const { service } = harness();
    await expect(service.getTeamAssets('other-user', 'team-1'))
      .rejects.toMatchObject({ code: 'TEAM_ASSET_OWNER_REQUIRED' });
  });

  it('rejects an owner without an approved league entry', async () => {
    const { service, prisma } = harness();
    prisma.seasonEntry.findFirst.mockResolvedValueOnce(null);
    await expect(service.getTeamAssets('user-1', 'team-1'))
      .rejects.toMatchObject({ code: 'TEAM_ASSET_SEASON_ENTRY_REQUIRED' });
  });

  it('returns immutable valuation trend only to a league participant', async () => {
    const { service, prisma } = harness();
    await expect(service.getPlayerValuationHistory('user-1', 'league-1', 'player-1'))
      .resolves.toMatchObject({ playerName: '有效球员', items: [{ valueMinor: 8000 }] });
    prisma.seasonEntry.findFirst.mockResolvedValueOnce(null);
    await expect(service.getPlayerValuationHistory('outsider', 'league-1', 'player-1'))
      .rejects.toMatchObject({ code: 'LEAGUE_PARTICIPANT_REQUIRED' });
  });
});
