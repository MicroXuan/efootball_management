import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { ForcedOfferWindowsService } from './forced-offer-windows.service.js';
import { AdminForcedOfferWindowsController } from './admin-forced-offer-windows.controller.js';

describe('ForcedOfferWindowsService', () => {
  const adminId = randomUUID();
  const leagueId = randomUUID();
  const seasonId = randomUUID();
  const period = (startsAt = '2027-01-01T00:00:00.000Z', endsAt = '2027-01-02T00:00:00.000Z') => ({
    name: '第一轮强报', startsAt, endsAt,
  });

  function harness() {
    const rows: Array<Record<string, any>> = [];
    const receipts = new Map<string, unknown>();
    const calls: string[] = [];
    const windows = {
      findMany: jest.fn(async () => rows.map((row) => ({ ...row }))),
      findFirst: jest.fn(async ({ where }: any) => rows.find((row) =>
        row.seasonId === where.seasonId && row.id !== where.id?.not &&
        row.startsAt < where.startsAt.lt && row.endsAt > where.endsAt.gt) ?? null),
      findUnique: jest.fn(async ({ where }: any) => rows.find((row) => row.id === where.id) ?? null),
      create: jest.fn(async ({ data }: any) => {
        calls.push('create');
        const row = { ...data, id: randomUUID(), version: 1, createdAt: new Date(), updatedAt: new Date() };
        rows.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.find((item) => item.id === where.id)!;
        Object.assign(row, data, { version: row.version + 1, updatedAt: new Date() });
        return row;
      }),
    };
    const tx = {
      $queryRaw: jest.fn(async () => { calls.push('lock'); return []; }),
      forcedOfferWindow: windows,
      playerAcquisitionApplication: { count: jest.fn(async () => 0) },
    };
    const prisma = {
      leagueSeason: { findFirst: jest.fn(async ({ where }: any) =>
        where.id === seasonId && where.leagueId === leagueId ? { id: seasonId, leagueId } : null) },
      forcedOfferWindow: windows,
    };
    const authorization = { requireLeagueManager: jest.fn(async () => ({})) };
    const audit = { record: jest.fn(async () => ({})) };
    const receipt = { execute: jest.fn(async (actor: string, operation: string, key: string, work: (tx: any) => Promise<unknown>) => {
      const receiptKey = `${actor}:${operation}:${key}`;
      if (receipts.has(receiptKey)) return receipts.get(receiptKey);
      const result = await work(tx);
      receipts.set(receiptKey, result);
      return result;
    }) };
    const service = new ForcedOfferWindowsService(prisma as any, authorization as any, audit as any, receipt as any);
    return { service, windows, tx, authorization, audit, calls, rows };
  }

  it('requires admin access and matching league season for reads and writes', async () => {
    const { service, authorization } = harness();
    authorization.requireLeagueManager.mockRejectedValueOnce({ code: 'ADMIN_LEAGUE_ACCESS_DENIED' });
    await expect(service.list(adminId, leagueId, seasonId)).rejects.toMatchObject({ code: 'ADMIN_LEAGUE_ACCESS_DENIED' });
    await expect(service.create(adminId, randomUUID(), seasonId, period(), 'k1')).rejects.toMatchObject({ code: 'SEASON_NOT_FOUND' });
  });

  it('rejects overlap after locking the season but accepts adjacent periods and idempotent retry', async () => {
    const { service, calls, windows } = harness();
    const first = await service.create(adminId, leagueId, seasonId, period(), 'k1');
    await expect(service.create(adminId, leagueId, seasonId, period('2027-01-01T12:00:00.000Z', '2027-01-03T00:00:00.000Z'), 'k2'))
      .rejects.toMatchObject({ code: 'FORCED_OFFER_WINDOW_OVERLAP' });
    const adjacent = await service.create(adminId, leagueId, seasonId, period('2027-01-02T00:00:00.000Z', '2027-01-03T00:00:00.000Z'), 'k3');
    expect(adjacent.id).not.toBe(first.id);
    expect(await service.create(adminId, leagueId, seasonId, period(), 'k1')).toEqual(first);
    expect(windows.create).toHaveBeenCalledTimes(2);
    expect(calls[0]).toBe('lock');
    expect(calls[1]).toBe('create');
  });

  it('rejects invalid dates and stale versions', async () => {
    const { service } = harness();
    await expect(service.create(adminId, leagueId, seasonId, period('2027-01-02T00:00:00.000Z', '2027-01-01T00:00:00.000Z'), 'bad'))
      .rejects.toMatchObject({ code: 'FORCED_OFFER_WINDOW_INVALID_DATES' });
    const created = await service.create(adminId, leagueId, seasonId, period(), 'k1');
    await expect(service.update(adminId, leagueId, seasonId, created.id, { ...period(), expectedVersion: 2 }, 'k2'))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('locks a started period start and never shortens a period with bids, but allows safe extension', async () => {
    const { service, tx, rows } = harness();
    const created = await service.create(adminId, leagueId, seasonId, period('2020-01-01T00:00:00.000Z', '2030-01-02T00:00:00.000Z'), 'k1');
    await expect(service.update(adminId, leagueId, seasonId, created.id, {
      ...period('2020-01-02T00:00:00.000Z', '2030-01-02T00:00:00.000Z'), expectedVersion: 1,
    }, 'k2')).rejects.toMatchObject({ code: 'FORCED_OFFER_WINDOW_LOCKED' });
    tx.playerAcquisitionApplication.count.mockResolvedValue(1);
    await expect(service.update(adminId, leagueId, seasonId, created.id, {
      ...period('2020-01-01T00:00:00.000Z', '2029-01-02T00:00:00.000Z'), expectedVersion: 1,
    }, 'k3')).rejects.toMatchObject({ code: 'FORCED_OFFER_WINDOW_LOCKED' });
    const updated = await service.update(adminId, leagueId, seasonId, created.id, {
      ...period('2020-01-01T00:00:00.000Z', '2031-01-02T00:00:00.000Z'), expectedVersion: 1,
    }, 'k4');
    expect(updated.version).toBe(2);
    expect(rows).toHaveLength(1);
  });

  it('exposes season-scoped list and controller delegation', async () => {
    const { service, authorization } = harness();
    await service.create(adminId, leagueId, seasonId, period(), 'k1');
    const controller = new AdminForcedOfferWindowsController(service);
    expect((await controller.list({ id: adminId } as any, leagueId, seasonId)).items).toHaveLength(1);
    expect(authorization.requireLeagueManager).toHaveBeenCalledWith(adminId, leagueId);
  });
});
