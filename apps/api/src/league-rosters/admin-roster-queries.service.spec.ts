import { jest } from '@jest/globals';
import { AdminRosterQueriesService } from './admin-roster-queries.service.js';

const leagueId = '11111111-1111-4111-8111-111111111111';
const packId = '22222222-2222-4222-8222-222222222222';

describe('AdminRosterQueriesService candidate filters', () => {
  it('quotes a same-team card upgrade with the Bird discount without changing purchase salary', async () => {
    const prisma = {
      leagueSalaryRuleVersion: { findFirst: async () => ({ tiers: [
        { minOverall: 0, maxOverall: 92, salaryMinor: 100 },
        { minOverall: 93, maxOverall: 94, salaryMinor: 200 },
        { minOverall: 95, maxOverall: 120, salaryMinor: 400 }
      ] }) },
      footballPlayer: { findMany: async () => [{
        id: '33333333-3333-4333-8333-333333333333', nameZh: '球员', nameEn: null, shortName: null,
        bestCard: null,
        leagueOwnerships: [{ leagueTeamId: 'team-1', maxOverallSnapshot: 93, birdBaselineOverall: 93 }],
        cards: [{ id: '44444444-4444-4444-8444-444444444444', cardName: '新卡', imageUrl: null,
          position: 'CB', overallRating: 95, attributes: null, autoBuilds: [{ maxOverall: 95 }] }]
      }] }
    };
    const service = new AdminRosterQueriesService(prisma as never, { requireVisible: async () => leagueId } as never);
    const card = (await service.candidates(leagueId, { keyword: '球员' })).items[0]?.cards[0];
    expect(card).toMatchObject({ salaryMinor: 400, upgradeSalaryMinor: 200 });
  });
  it('paginates finance records and includes the team number', async () => {
    const findMany = jest.fn(async () => [1, 2].map((number) => ({
      id: `entry-${number}`, leagueId, leagueTeamId: 'team-1', seasonId: null,
      rosterTransactionId: null, direction: 'DEBIT', type: 'LUXURY_TAX',
      settlementCategory: null, amountMinor: 100, note: 'test', createdAt: new Date(),
      leagueTeam: { name: '甲队', teamNumber: 3 }
    })));
    const service = new AdminRosterQueriesService({ financeLedgerEntry: { findMany } } as never, {
      requireVisible: async () => leagueId
    } as never);
    const result = await service.ledger(leagueId, undefined, undefined, 1);
    expect(result).toMatchObject({ items: [{ id: 'entry-1', teamNumber: 3 }], nextCursor: 'entry-1' });
    await service.ledger(leagueId, undefined, 'entry-1', 1);
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: { id: 'entry-1' }, skip: 1, take: 2 }));
  });
  it('shows the selected team cap instead of the league rule cap in a roster', async () => {
    const prisma = {
      leagueTeam: { findFirst: async () => ({ id: 'team-1', name: 'Team One', salaryCapMinor: 500 }) },
      leaguePlayerOwnership: { findMany: async () => [] },
      leagueSalaryRuleVersion: { findFirst: async () => ({ salaryCapMinor: 10_000 }) },
      transferWindow: { findFirst: async () => null }
    };
    const service = new AdminRosterQueriesService(prisma as never, {
      requireVisible: async () => leagueId
    } as never);

    const roster = await service.roster(leagueId, 'team-1', 'season-1');

    expect(roster.summary).toEqual({ rosterCount: 0, salaryMinor: 0, salaryCapMinor: 500 });
  });

  it('returns only players with cards matching every selected filter', async () => {
    const players = [{
      id: '33333333-3333-4333-8333-333333333333',
      nameZh: '梅西', nameEn: 'Lionel Messi', shortName: '梅西',
      bestCard: { playerCardId: '44444444-4444-4444-8444-444444444444' },
      leagueOwnerships: [],
      cards: [{
        id: '44444444-4444-4444-8444-444444444444', cardName: '蓝白传奇', imageUrl: null,
        position: 'AMF', overallRating: 99, cardType: 'EPIC', cardPackId: packId,
        attributes: null,
        autoBuilds: [{ maxOverall: 103, dtRating: 101 }]
      }, {
        id: '55555555-5555-4555-8555-555555555555', cardName: '基础卡', imageUrl: null,
        position: 'RWF', overallRating: 90, cardType: 'STANDARD', cardPackId: null,
        attributes: null,
        autoBuilds: [{ maxOverall: 94, dtRating: 93 }]
      }]
    }, {
      id: '66666666-6666-4666-8666-666666666666',
      nameZh: '无匹配球员', nameEn: null, shortName: null, bestCard: null,
      leagueOwnerships: [],
      cards: []
    }];
    const prisma = {
      leagueSalaryRuleVersion: { findFirst: async () => null },
      footballPlayer: {
        findMany: async (args: { where: { cards: { some: Record<string, unknown> } } }) => {
          const filters = args.where.cards.some;
          return players.flatMap((player) => {
            const cards = player.cards.filter((card) => (
              (!filters.position || card.position === filters.position)
              && (!filters.cardType || card.cardType === filters.cardType)
              && (!filters.cardPackId || card.cardPackId === filters.cardPackId)
            ));
            return cards.length ? [{ ...player, cards }] : [];
          });
        }
      }
    };
    const service = new AdminRosterQueriesService(prisma as never, {
      requireVisible: async () => leagueId
    } as never);

    const result = await service.candidates(leagueId, {
      keyword: '梅西', position: 'AMF', cardType: 'EPIC', cardPackId: packId
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.playerName).toBe('梅西');
    expect(result.items[0]?.cards.map(({ cardName }) => cardName)).toEqual(['蓝白传奇']);
  });

  it('shows the derived automatic build total and salary for legacy cards', async () => {
    const prisma = {
      leagueSalaryRuleVersion: {
        findFirst: async () => ({
          tiers: [{ minOverall: 90, maxOverall: 99, salaryMinor: 500 }]
        })
      },
      footballPlayer: {
        findMany: async () => [{
          id: '33333333-3333-4333-8333-333333333333',
          nameZh: '主多·罗德里格斯', nameEn: null, shortName: null,
          bestCard: null,
          leagueOwnerships: [],
          cards: [{
            id: '44444444-4444-4444-8444-444444444444',
            cardName: 'Spanish League Selection Midfielders', imageUrl: null,
            position: 'DMF', overallRating: 80, cardType: 'HIGHLIGHT', cardPackId: packId,
            attributes: { attributesJson: { sourceMetadata: { maxLevel: 80 } } },
            autoBuilds: []
          }]
        }]
      }
    };
    const service = new AdminRosterQueriesService(prisma as never, {
      requireVisible: async () => leagueId
    } as never);

    const result = await service.candidates(leagueId, { keyword: '罗德里格斯' });

    expect(result.items[0]?.cards[0]).toMatchObject({
      overallRating: 80,
      maxOverall: 95,
      salaryMinor: 500
    });
  });

  it('prices an epic card with zero progression points at its published overall', async () => {
    const prisma = {
      leagueSalaryRuleVersion: {
        findFirst: async () => ({
          tiers: [{ minOverall: 0, maxOverall: 92, salaryMinor: 100 }]
        })
      },
      footballPlayer: {
        findMany: async () => [{
          id: '33333333-3333-4333-8333-333333333333',
          nameZh: '克拉伦斯·西多夫', nameEn: 'Clarence Seedorf', shortName: null,
          bestCard: null,
          leagueOwnerships: [],
          cards: [{
            id: '44444444-4444-4444-8444-444444444444',
            cardName: "European Clubs Selection Midfielders 19 Oct '26", imageUrl: null,
            position: 'CMF', overallRating: 87, cardType: 'EPIC', cardPackId: packId,
            attributes: { attributesJson: { sourceMetadata: { Level: '-', maxLevel: '0' } } },
            autoBuilds: []
          }]
        }]
      }
    };
    const service = new AdminRosterQueriesService(prisma as never, {
      requireVisible: async () => leagueId
    } as never);

    const result = await service.candidates(leagueId, { keyword: '西多夫' });

    expect(result.items[0]?.cards[0]).toMatchObject({
      overallRating: 87,
      maxOverall: 87,
      salaryMinor: 100
    });
  });
});
