import { jest } from '@jest/globals';
import { NominationWindowService } from './nomination-window.service.js';

const start = '2026-10-20T00:00:00.000Z';
const end = '2026-10-25T00:00:00.000Z';

function harness() {
  const windows: Array<Record<string, unknown>> = [];
  const tx = {
    $queryRaw: jest.fn(async () => [{ id: 'season-1' }]),
    nominationWindow: {
      findMany: jest.fn(async ({ where }: { where: { id?: { not: string }, startsAt?: { lt: Date }, endsAt?: { gt: Date } } }) => windows.filter((item) =>
        (!where.id || item.id !== where.id.not) &&
        (!where.startsAt || (item.startsAt as Date) < where.startsAt.lt) &&
        (!where.endsAt || (item.endsAt as Date) > where.endsAt.gt)
      )),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => windows.find((item) => item.id === where.id)!),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const value = { id: `window-${windows.length + 1}`, version: 1, createdAt: new Date(), updatedAt: new Date(), ...data };
        windows.push(value);
        return value;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }, data: Record<string, unknown> }) => {
        const value = windows.find((item) => item.id === where.id)!;
        const nextVersion = Number(value.version) + 1;
        Object.assign(value, data, { version: nextVersion });
        return value;
      })
    }
  };
  const prisma = { leagueSeason: { findFirst: jest.fn(async () => ({ id: 'season-1', leagueId: 'league-1' })) }, ...tx };
  const authorization = { requireLeagueManager: jest.fn(async () => undefined) };
  const receipts = { execute: jest.fn(async (_admin: string, _scope: string, _key: string, operation: (client: unknown) => Promise<unknown>) => operation(tx)) };
  const audit = { record: jest.fn(async () => undefined) };
  const service = new NominationWindowService(prisma as never, authorization as never, audit as never, receipts as never);
  return { service, windows, authorization, tx, audit };
}

describe('NominationWindowService', () => {
  it('denies an unauthorized admin and validates timeline and positive team limit', async () => {
    const { service, authorization } = harness();
    authorization.requireLeagueManager.mockRejectedValueOnce(new Error('forbidden'));
    await expect(service.create('admin-1', 'league-1', 'season-1', { startsAt: start, endsAt: end, perTeamLimit: 3 }, 'k1')).rejects.toThrow('forbidden');
    await expect(service.create('admin-1', 'league-1', 'season-1', { startsAt: end, endsAt: start, perTeamLimit: 3 }, 'k2')).rejects.toBeDefined();
    await expect(service.create('admin-1', 'league-1', 'season-1', { startsAt: start, endsAt: end, perTeamLimit: 0 }, 'k3')).rejects.toBeDefined();
  });

  it('rejects overlapping windows and stale edits', async () => {
    const { service, audit } = harness();
    const first = await service.create('admin-1', 'league-1', 'season-1', { startsAt: start, endsAt: end, perTeamLimit: 3 }, 'k1');
    await expect(service.create('admin-1', 'league-1', 'season-1', { startsAt: '2026-10-24T00:00:00.000Z', endsAt: '2026-10-27T00:00:00.000Z', perTeamLimit: 2 }, 'k2')).rejects.toMatchObject({ status: 409 });
    await expect(service.update('admin-1', 'league-1', 'season-1', first.id, { expectedVersion: 9, perTeamLimit: 4 }, 'k3')).rejects.toMatchObject({ status: 409 });
    const updated = await service.update('admin-1', 'league-1', 'season-1', first.id, { expectedVersion: 1, perTeamLimit: 4 }, 'k4');
    expect(updated).toMatchObject({ perTeamLimit: 4, version: 2 });
    expect(audit.record).toHaveBeenCalledTimes(2);
  });

  it('treats the exact end as closed', async () => {
    const { service } = harness();
    const window = await service.create('admin-1', 'league-1', 'season-1', { startsAt: start, endsAt: end, perTeamLimit: 3 }, 'k1');
    expect(service.isOpen(window, new Date(end))).toBe(false);
    expect(service.isOpen(window, new Date(start))).toBe(true);
  });
});
