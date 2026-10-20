import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { SeasonCalendarNoteService } from './season-calendar-note.service.js';
import { AdminSeasonCalendarNotesController } from './admin-season-calendar-notes.controller.js';

const adminId = randomUUID();
const leagueId = randomUUID();
const seasonId = randomUUID();
const input = { kind: 'HOLIDAY' as const, title: '国庆假期', description: '暂停考核', startsOn: '2026-10-01', endsOn: '2026-10-07' };

function harness() {
  const rows = new Map<string, any>();
  const receipts = new Map<string, unknown>();
  const notes = {
    create: jest.fn(async ({ data }: any) => {
      const row = { ...data, id: randomUUID(), version: 1, createdAt: new Date(), updatedAt: new Date(), deletedAt: null };
      rows.set(row.id, row);
      return row;
    }),
    findUnique: jest.fn(async ({ where }: any) => rows.get(where.id) ?? null),
    findUniqueOrThrow: jest.fn(async ({ where }: any) => rows.get(where.id)!),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const row = rows.get(where.id);
      if (!row || row.version !== where.version || row.deletedAt) return { count: 0 };
      Object.assign(row, data, { version: row.version + 1, updatedAt: new Date() });
      return { count: 1 };
    })
  };
  const tx = { seasonCalendarNote: notes };
  const prisma = {
    leagueSeason: { findFirst: jest.fn(async ({ where }: any) => where.id === seasonId && where.leagueId === leagueId ? { id: seasonId } : null) },
    seasonCalendarNote: notes
  };
  const authorization = { requireLeagueManager: jest.fn(async () => ({})) };
  const audit = { record: jest.fn(async () => ({})) };
  const receipt = { execute: jest.fn(async (actor: string, op: string, key: string, work: (tx: any) => Promise<unknown>) => {
    const receiptKey = `${actor}:${op}:${key}`;
    if (receipts.has(receiptKey)) return receipts.get(receiptKey);
    const result = await work(tx);
    receipts.set(receiptKey, result);
    return result;
  }) };
  return { service: new SeasonCalendarNoteService(prisma as any, authorization as any, audit as any, receipt as any), notes, rows, authorization, audit, receipt };
}

describe('season calendar notes', () => {
  it('creates an inclusive all-day note, records the actor and retries idempotently', async () => {
    const { service, audit, notes } = harness();
    const first = await service.create(adminId, leagueId, seasonId, input, 'key-1');
    expect(first).toMatchObject({ kind: 'HOLIDAY', startsOn: '2026-10-01', endsOn: '2026-10-07', version: 1 });
    expect(await service.create(adminId, leagueId, seasonId, input, 'key-1')).toEqual(first);
    expect(notes.create).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actorAdminId: adminId, leagueId, resourceId: first.id }));
  });

  it('checks grant, season scope, date order and optimistic version', async () => {
    const { service, authorization } = harness();
    authorization.requireLeagueManager.mockRejectedValueOnce({ code: 'ADMIN_LEAGUE_ACCESS_DENIED' });
    await expect(service.create(adminId, leagueId, seasonId, input, 'denied')).rejects.toMatchObject({ code: 'ADMIN_LEAGUE_ACCESS_DENIED' });
    await expect(service.create(adminId, randomUUID(), seasonId, input, 'wrong-league')).rejects.toMatchObject({ code: 'SEASON_NOT_FOUND' });
    await expect(service.create(adminId, leagueId, seasonId, { ...input, endsOn: '2026-09-30' }, 'invalid')).rejects.toMatchObject({ code: 'CALENDAR_NOTE_INVALID' });
    const created = await service.create(adminId, leagueId, seasonId, input, 'valid');
    await expect(service.update(adminId, leagueId, seasonId, created.id, { ...input, title: '调整', expectedVersion: 2 }, 'stale'))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('edits, soft-deletes and keeps a deleted note unavailable for further edits', async () => {
    const { service, rows, audit } = harness();
    const created = await service.create(adminId, leagueId, seasonId, input, 'create');
    const updated = await service.update(adminId, leagueId, seasonId, created.id, { ...input, title: '维护', kind: 'MAINTENANCE', expectedVersion: 1 }, 'update');
    expect(updated).toMatchObject({ title: '维护', kind: 'MAINTENANCE', version: 2 });
    const deleted = await service.remove(adminId, leagueId, seasonId, created.id, 2, 'delete');
    expect(deleted.deletedAt).not.toBeNull();
    expect(rows.get(created.id)).toMatchObject({ title: '维护', version: 3 });
    await expect(service.update(adminId, leagueId, seasonId, created.id, { ...input, expectedVersion: 3 }, 'after-delete'))
      .rejects.toMatchObject({ code: 'CALENDAR_NOTE_NOT_FOUND' });
    expect(audit.record).toHaveBeenCalledTimes(3);
  });

  it('delegates the guarded admin routes with the same idempotency key', async () => {
    const { service, receipt } = harness();
    const controller = new AdminSeasonCalendarNotesController(service);
    const admin = { id: adminId } as any;
    const created = await controller.create(admin, leagueId, seasonId, input, 'create-key');
    await controller.update(admin, leagueId, seasonId, created.id, { ...input, expectedVersion: 1 }, 'update-key');
    await controller.remove(admin, leagueId, seasonId, created.id, { expectedVersion: 2 }, 'delete-key');
    expect(receipt.execute).toHaveBeenCalledTimes(3);
    expect(() => controller.create(admin, leagueId, seasonId, input)).toThrow(expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REQUIRED' }));
  });
});
