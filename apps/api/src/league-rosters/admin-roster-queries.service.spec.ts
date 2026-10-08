import { AdminRosterQueriesService } from './admin-roster-queries.service.js';

const leagueId = '11111111-1111-4111-8111-111111111111';
const packId = '22222222-2222-4222-8222-222222222222';

describe('AdminRosterQueriesService candidate filters', () => {
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
    const service = new AdminRosterQueriesService(prisma as never);

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
    const service = new AdminRosterQueriesService(prisma as never);

    const result = await service.candidates(leagueId, { keyword: '罗德里格斯' });

    expect(result.items[0]?.cards[0]).toMatchObject({
      overallRating: 80,
      maxOverall: 95,
      salaryMinor: 500
    });
  });
});
