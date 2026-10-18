import { jest } from '@jest/globals';
import { AdminLeaguesService } from './admin-leagues.service.js';

describe('AdminLeaguesService', () => {
  it('defaults screenshot requirement off and audits an optimistic administrator change', async () => {
    const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'league-evidence', ...data, status: 'ACTIVE', version: 1,
      createdAt: new Date('2026-10-15T00:00:00.000Z'), updatedAt: new Date('2026-10-15T00:00:00.000Z')
    }));
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const record = { ...await create({ data: {
      name: '测试', shortName: '测试', description: '', logoUrl: null, edition: 'NATIONAL',
      resultEvidenceRequired: false, defaultSuperCapacity: 23, defaultChampionCapacity: 18,
      defaultPromotionCount: 4
    } }), version: 1 };
    const findFirst = jest.fn(async () => record);
    findFirst.mockResolvedValueOnce({ id: 'league-evidence' } as never)
      .mockResolvedValueOnce({ resultEvidenceRequired: false } as never)
      .mockResolvedValueOnce({ ...record, resultEvidenceRequired: true, version: 2 } as never);
    const transaction = { league: { create, updateMany, findFirst } };
    const receipts = { execute: jest.fn(async (_actor: string, _operation: string, _key: string,
      work: (value: typeof transaction) => Promise<unknown>) => work(transaction)) };
    const audit = { record: jest.fn(async () => undefined) };
    const service = new AdminLeaguesService({ league: { findFirst } } as never, receipts as never, audit as never);
    const created = await service.create('admin-1', {
      name: '测试', shortName: '测试', description: '', logoUrl: null, edition: 'NATIONAL',
      defaultSuperCapacity: 23, defaultChampionCapacity: 18, defaultPromotionCount: 4
    }, 'create-evidence');
    expect(created.resultEvidenceRequired).toBe(false);
    const updated = await service.update('admin-1', 'league-evidence', {
      resultEvidenceRequired: true, expectedVersion: 1
    }, 'update-evidence');
    expect(updated.resultEvidenceRequired).toBe(true);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ version: 1 }),
      data: expect.objectContaining({ resultEvidenceRequired: true })
    }));
    expect(audit.record).toHaveBeenCalledWith(transaction, expect.objectContaining({
      action: 'admin.league.update', metadata: {
        resultEvidenceRequired: true,
        previousResultEvidenceRequired: false
      }
    }));
  });
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
    expect(prisma.league.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isDeleted: false }
    }));
  });

  it('returns a browser-readable URL for a CloudBase league logo', async () => {
    const prisma = { league: { findMany: jest.fn(async () => [{
      id: 'league-cloud-logo',
      name: '体验联赛',
      shortName: '体验',
      description: '',
      logoUrl: 'cloud://env/league-images--logo.png',
      status: 'ACTIVE',
      edition: 'NATIONAL',
      resultEvidenceRequired: false,
      defaultSuperCapacity: 23,
      defaultChampionCapacity: 18,
      defaultPromotionCount: 4,
      currentSeason: null,
      version: 1,
      createdAt: new Date('2026-10-17T00:00:00.000Z'),
      updatedAt: new Date('2026-10-17T00:00:00.000Z')
    }]) } };
    const storage = {
      temporaryReadUrl: jest.fn(async () => 'https://temporary.example/league-logo.png')
    };
    const Service = AdminLeaguesService as unknown as new (...args: unknown[]) => AdminLeaguesService;
    const service = new Service(prisma, {}, {}, storage);

    await expect(service.list()).resolves.toMatchObject({
      items: [{ logoUrl: 'https://temporary.example/league-logo.png' }]
    });
    expect(storage.temporaryReadUrl).toHaveBeenCalledWith(
      'cloud://env/league-images--logo.png',
      3600
    );
  });

  it('loads one scoped league workspace with its current season', async () => {
    const findFirst = jest.fn(async () => ({
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
      { league: { findFirst } } as never,
      {} as never,
      {} as never
    );

    await expect(service.get('league-1')).resolves.toMatchObject({
      id: 'league-1',
      currentSeason: { id: 'season-20', approvedEntryCount: 67 },
      capabilities: { canManage: true, canCreateSeason: true }
    });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'league-1', isDeleted: false }
    }));
  });

  it('returns not found before opening a mutation receipt for a deleted league', async () => {
    const findFirst = jest.fn(async () => null);
    const receipts = { execute: jest.fn(async () => undefined) };
    const audit = { record: jest.fn() };
    const service = new AdminLeaguesService(
      { league: { findFirst } } as never,
      receipts as never,
      audit as never
    );

    await expect(service.update('admin-1', 'deleted-league', {
      name: '不应写入',
      expectedVersion: 1
    }, 'update-deleted')).rejects.toMatchObject({
      status: 404,
      response: { code: 'LEAGUE_NOT_FOUND' }
    });
    expect(receipts.execute).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
