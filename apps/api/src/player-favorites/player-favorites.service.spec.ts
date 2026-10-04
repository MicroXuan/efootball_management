import { PlayerFavoritesService } from './player-favorites.service.js';

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const playerA = '33333333-3333-4333-8333-333333333333';
const playerB = '44444444-4444-4444-8444-444444444444';
const playerHidden = '55555555-5555-4555-8555-555555555555';
const cardA = '66666666-6666-4666-8666-666666666666';
const cardB = '77777777-7777-4777-8777-777777777777';
const inactiveBest = '88888888-8888-4888-8888-888888888888';

type FavoriteRow = {
  id: string;
  userId: string;
  footballPlayerId: string;
  createdAt: Date;
  footballPlayer: { nameZh: string | null; nameEn: string | null; shortName: string | null; bestCard: { playerCardId: string } | null };
};

function version(input: {
  id: string;
  playerId: string;
  name: string;
  cardName: string;
  overall: number;
  status?: 'ACTIVE' | 'INACTIVE';
  publishedAt?: string;
}) {
  return {
    id: `version-${input.id}`,
    releaseId: '99999999-9999-4999-8999-999999999999',
    releaseSequence: 2,
    playerCardId: input.id,
    playerId: input.playerId,
    playerNameZh: input.name,
    playerNameEn: null,
    playerShortName: input.name,
    normalizedNameZh: input.name.toLocaleLowerCase('zh-CN'),
    normalizedNameEn: null,
    nationality: '阿根廷',
    club: '迈阿密国际',
    cardPackId: null,
    cardName: input.cardName,
    position: 'AMF' as const,
    overallRating: input.overall,
    cardType: 'EPIC' as const,
    playStyle: null,
    status: input.status ?? 'ACTIVE',
    imageUrl: null,
    attributesJson: {},
    skillsJson: [],
    sourceUpdatedAt: null,
    publishedAt: new Date(input.publishedAt ?? '2026-09-01T00:00:00.000Z'),
    packExternalId: null,
    packNameZh: null,
    packNameEn: null,
    packSeason: null,
    packReleaseDate: null,
    packCoverUrl: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z')
  };
}

function createPrisma() {
  const players = new Set([playerA, playerB, playerHidden]);
  const rows: FavoriteRow[] = [
    {
      id: 'a0000000-0000-4000-8000-000000000001', userId: userA, footballPlayerId: playerA,
      createdAt: new Date('2026-10-02T12:00:00.000Z'),
      footballPlayer: { nameZh: '梅西', nameEn: 'Lionel Messi', shortName: '梅西', bestCard: { playerCardId: inactiveBest } }
    },
    {
      id: 'a0000000-0000-4000-8000-000000000002', userId: userA, footballPlayerId: playerB,
      createdAt: new Date('2026-10-02T12:00:00.000Z'),
      footballPlayer: { nameZh: '伊涅斯塔', nameEn: 'Iniesta', shortName: '小白', bestCard: { playerCardId: cardB } }
    },
    {
      id: 'a0000000-0000-4000-8000-000000000003', userId: userA, footballPlayerId: playerHidden,
      createdAt: new Date('2026-10-01T12:00:00.000Z'),
      footballPlayer: { nameZh: '无卡球员', nameEn: null, shortName: null, bestCard: null }
    },
    {
      id: 'a0000000-0000-4000-8000-000000000004', userId: userB, footballPlayerId: playerA,
      createdAt: new Date('2026-09-30T12:00:00.000Z'),
      footballPlayer: { nameZh: '梅西', nameEn: 'Lionel Messi', shortName: '梅西', bestCard: null }
    }
  ];
  const versions = [
    version({ id: inactiveBest, playerId: playerA, name: '梅西', cardName: '旧传奇', overall: 101, status: 'INACTIVE' }),
    version({ id: cardA, playerId: playerA, name: '梅西', cardName: '蓝白传奇', overall: 99 }),
    version({ id: cardB, playerId: playerB, name: '伊涅斯塔', cardName: '中场大师', overall: 98 })
  ];

  return {
    rows,
    footballPlayer: {
      findUnique: async ({ where }: { where: { id: string } }) => players.has(where.id) ? { id: where.id } : null
    },
    userPlayerFavorite: {
      upsert: async ({ where, create }: { where: { userId_footballPlayerId: { userId: string; footballPlayerId: string } }; create: { userId: string; footballPlayerId: string } }) => {
        const key = where.userId_footballPlayerId;
        const existing = rows.find((row) => row.userId === key.userId && row.footballPlayerId === key.footballPlayerId);
        if (existing) return existing;
        const created = {
          id: `b0000000-0000-4000-8000-${String(rows.length).padStart(12, '0')}`,
          ...create,
          createdAt: new Date('2026-10-03T00:00:00.000Z'),
          footballPlayer: { nameZh: null, nameEn: null, shortName: null, bestCard: null }
        };
        rows.push(created);
        return created;
      },
      deleteMany: async ({ where }: { where: { userId: string; footballPlayerId: string } }) => {
        const index = rows.findIndex((row) => row.userId === where.userId && row.footballPlayerId === where.footballPlayerId);
        if (index < 0) return { count: 0 };
        rows.splice(index, 1);
        return { count: 1 };
      },
      findMany: async (args: {
        where: {
          userId: string;
          footballPlayerId?: { in: string[] };
          footballPlayer?: unknown;
          OR?: Array<{ createdAt?: Date | { lt: Date }; id?: { lt: string } }>;
        };
        take?: number;
        select?: unknown;
      }) => {
        let found = rows.filter((row) => row.userId === args.where.userId);
        if (args.where.footballPlayerId) {
          found = found.filter((row) => args.where.footballPlayerId!.in.includes(row.footballPlayerId));
        }
        if (args.where.footballPlayer) {
          found = found.filter((row) => row.footballPlayerId !== playerHidden);
          if (JSON.stringify(args.where.footballPlayer).includes('蓝白')) {
            found = found.filter((row) => row.footballPlayerId === playerA);
          }
        }
        const boundary = args.where.OR;
        if (boundary) {
          const olderThan = boundary[0]?.createdAt as { lt: Date } | undefined;
          const sameTime = boundary[1]?.createdAt as Date | undefined;
          const lowerId = boundary[1]?.id?.lt;
          found = found.filter((row) => (
            (olderThan && row.createdAt < olderThan.lt)
            || (sameTime && lowerId && row.createdAt.getTime() === sameTime.getTime() && row.id < lowerId)
          ));
        }
        return found
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id))
          .slice(0, args.take);
      },
    },
    catalogRelease: { findFirst: async () => ({ sequence: 2 }) },
    playerCardVersion: {
      findMany: async ({ where }: { where: { playerId: { in: string[] } } }) => versions.filter((item) => where.playerId.in.includes(item.playerId))
    }
  };
}

describe('PlayerFavoritesService', () => {
  it('keeps favorite and unfavorite idempotent while rejecting an unknown player', async () => {
    const prisma = createPrisma();
    const service = new PlayerFavoritesService(prisma as never);

    await service.favorite(userA, playerA);
    await service.favorite(userA, playerA);
    expect(prisma.rows.filter((row) => row.userId === userA && row.footballPlayerId === playerA)).toHaveLength(1);
    await service.unfavorite(userA, playerA);
    await service.unfavorite(userA, playerA);
    expect(prisma.rows.some((row) => row.userId === userA && row.footballPlayerId === playerA)).toBe(false);

    await expect(service.favorite(userA, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).rejects.toMatchObject({
      response: { code: 'PLAYER_NOT_FOUND' }
    });
  });

  it('isolates status results by user and removes duplicate ids', async () => {
    const service = new PlayerFavoritesService(createPrisma() as never);
    await expect(service.statuses(userA, [playerA, playerA, playerB])).resolves.toEqual({
      favoritePlayerIds: [playerA, playerB]
    });
    await expect(service.statuses(userB, [playerA, playerB])).resolves.toEqual({
      favoritePlayerIds: [playerA]
    });
  });

  it('uses an active saved best card and falls back when the saved best is inactive', async () => {
    const service = new PlayerFavoritesService(createPrisma() as never);
    const result = await service.list(userA, { limit: 20 });

    expect(result.items.map((item) => [item.playerId, item.card.id])).toEqual([
      [playerB, cardB],
      [playerA, cardA]
    ]);
    expect(result.items.some((item) => item.playerId === playerHidden)).toBe(false);
  });

  it('filters by player or card name and paginates equal timestamps without duplicates', async () => {
    const service = new PlayerFavoritesService(createPrisma() as never);
    const searched = await service.list(userA, { keyword: '蓝白', limit: 20 });
    expect(searched.items.map((item) => item.playerId)).toEqual([playerA]);

    const first = await service.list(userA, { limit: 1 });
    const second = await service.list(userA, { limit: 1, cursor: first.nextCursor ?? undefined });
    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.playerId).not.toBe(first.items[0]?.playerId);
  });
});
