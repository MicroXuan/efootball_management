import { jest } from '@jest/globals';
import { AdminLeaguesService } from './admin-leagues.service.js';

describe('AdminLeaguesService', () => {
  it('persists the required edition while keeping retired identity fields internal', async () => {
    const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'league-1',
      ...data,
      status: 'ACTIVE',
      currentSeasonId: null,
      version: 1,
      createdAt: new Date('2026-09-30T00:00:00.000Z'),
      updatedAt: new Date('2026-09-30T00:00:00.000Z')
    }));
    const transaction = { league: { create } };
    const receipts = {
      execute: jest.fn(async (
        _actor: string,
        _operation: string,
        _key: string,
        work: (value: typeof transaction) => Promise<unknown>
      ) => work(transaction))
    };
    const audit = { record: jest.fn(async () => undefined) };
    const service = new AdminLeaguesService({} as never, receipts as never, audit as never);

    const result = await service.create('admin-1', {
      name: 'CELL 联赛',
      shortName: 'CELL',
      description: '说明',
      logoUrl: null,
      edition: 'NATIONAL',
      defaultSuperCapacity: 23,
      defaultChampionCapacity: 18,
      defaultPromotionCount: 4
    }, 'create-1');

    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ edition: 'NATIONAL' }) });
    expect(result).toMatchObject({ edition: 'NATIONAL', currentSeason: null });
    expect(result).not.toHaveProperty('defaultPlatform');
    expect(result).not.toHaveProperty('defaultServerRegion');
  });

  it('reports the administrator-selected current season participant count', async () => {
    const prisma = { league: { findMany: jest.fn(async () => [{
      id: 'league-1',
      name: 'CELL 联赛',
      shortName: 'CELL',
      description: '',
      logoUrl: null,
      status: 'ACTIVE',
      edition: 'INTERNATIONAL',
      defaultSuperCapacity: 23,
      defaultChampionCapacity: 18,
      defaultPromotionCount: 4,
      currentSeason: {
        id: 'season-20',
        displayName: 'S20',
        status: 'IN_PROGRESS',
        _count: { entries: 67 }
      },
      version: 3,
      createdAt: new Date('2026-09-30T00:00:00.000Z'),
      updatedAt: new Date('2026-09-30T00:00:00.000Z')
    }]) } };
    const service = new AdminLeaguesService(prisma as never, {} as never, {} as never);

    await expect(service.list()).resolves.toMatchObject({
      items: [{ currentSeason: { id: 'season-20', approvedEntryCount: 67 } }]
    });
  });

  it('loads one scoped league workspace with its current season', async () => {
    const findUnique = jest.fn(async () => ({
      id: 'league-1',
      name: 'CELL 联赛',
      shortName: 'CELL',
      description: '',
      logoUrl: null,
      status: 'ACTIVE',
      edition: 'INTERNATIONAL',
      defaultSuperCapacity: 23,
      defaultChampionCapacity: 18,
      defaultPromotionCount: 4,
      currentSeason: {
        id: 'season-20',
        displayName: 'S20',
        status: 'IN_PROGRESS',
        _count: { entries: 67 }
      },
      version: 3,
      createdAt: new Date('2026-09-30T00:00:00.000Z'),
      updatedAt: new Date('2026-09-30T00:00:00.000Z')
    }));
    const service = new AdminLeaguesService(
      { league: { findUnique } } as never,
      {} as never,
      {} as never
    );

    await expect(service.get('league-1')).resolves.toMatchObject({
      id: 'league-1',
      currentSeason: { id: 'season-20', approvedEntryCount: 67 },
      capabilities: { canManage: true, canCreateSeason: true }
    });
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'league-1' }
    }));
  });
});
