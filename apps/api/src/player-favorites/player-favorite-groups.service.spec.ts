import { PlayerFavoritesService } from './player-favorites.service.js';

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const playerId = '33333333-3333-4333-8333-333333333333';
const groupId = '44444444-4444-4444-8444-444444444444';

function createPrisma() {
  const groups = [{ id: groupId, userId: userA, name: '自由球员', createdAt: new Date('2026-10-20T00:00:00Z') }];
  const favorites = [{ userId: userA, footballPlayerId: playerId, groupId: null as string | null }];
  return {
    groups,
    favorites,
    userPlayerFavoriteGroup: {
      findMany: async ({ where }: { where: { userId: string } }) => groups.filter((item) => item.userId === where.userId),
      findFirst: async ({ where }: { where: { id: string; userId: string } }) => groups.find((item) => item.id === where.id && item.userId === where.userId) ?? null,
      create: async ({ data }: { data: { userId: string; name: string } }) => {
        if (groups.some((item) => item.userId === data.userId && item.name === data.name)) throw { code: 'P2002' };
        const row = { id: '55555555-5555-4555-8555-555555555555', ...data, createdAt: new Date('2026-10-20T01:00:00Z') };
        groups.push(row);
        return row;
      },
      deleteMany: async ({ where }: { where: { id: string; userId: string } }) => {
        const index = groups.findIndex((item) => item.id === where.id && item.userId === where.userId);
        if (index < 0) return { count: 0 };
        groups.splice(index, 1);
        favorites.forEach((item) => { if (item.groupId === where.id) item.groupId = null; });
        return { count: 1 };
      }
    },
    userPlayerFavorite: {
      updateMany: async ({ where, data }: { where: { userId: string; footballPlayerId: string }; data: { groupId: string | null } }) => {
        const row = favorites.find((item) => item.userId === where.userId && item.footballPlayerId === where.footballPlayerId);
        if (!row) return { count: 0 };
        row.groupId = data.groupId;
        return { count: 1 };
      }
    }
  };
}

describe('favorite groups', () => {
  it('lists only the current user groups and rejects duplicate names', async () => {
    const prisma = createPrisma();
    const service = new PlayerFavoritesService(prisma as never);
    expect((await service.groups(userB)).items).toEqual([]);
    expect((await service.groups(userA)).items[0]?.name).toBe('自由球员');
    await expect(service.createGroup(userA, ' 自由球员 ')).rejects.toMatchObject({ status: 409 });
    expect((await service.createGroup(userB, '自由球员')).name).toBe('自由球员');
  });

  it('moves one favorite to an owned group and returns it to ungrouped on deletion', async () => {
    const prisma = createPrisma();
    const service = new PlayerFavoritesService(prisma as never);
    await expect(service.move(userB, playerId, groupId)).rejects.toMatchObject({ status: 404 });
    await expect(service.move(userA, playerId, '66666666-6666-4666-8666-666666666666')).rejects.toMatchObject({ status: 404 });
    await service.move(userA, playerId, groupId);
    expect(prisma.favorites[0]?.groupId).toBe(groupId);
    await expect(service.deleteGroup(userB, groupId)).rejects.toMatchObject({ status: 404 });
    await service.deleteGroup(userA, groupId);
    expect(prisma.favorites[0]?.groupId).toBeNull();
  });
});
