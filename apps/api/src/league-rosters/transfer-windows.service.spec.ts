import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { TransferWindowsService } from './transfer-windows.service.js';

config({ path: '../../.env', quiet: true });

describe('TransferWindowsService', () => {
  const prisma = new PrismaService();
  const service = new TransferWindowsService(
    prisma,
    new AdminAuthorizationService(prisma),
    new AuditLogService(prisma)
  );
  let adminId: string;
  let userId: string;
  let leagueId: string;
  let seasonId: string;

  beforeAll(() => prisma.$connect());

  beforeEach(async () => {
    adminId = (await prisma.adminAccount.create({
      data: {
        username: `window-${randomUUID()}`,
        displayName: 'Window Admin',
        passwordHash: 'test',
        platformRole: 'PLATFORM_ADMIN'
      }
    })).id;
    userId = (await prisma.user.create({
      data: { wechatOpenId: `window-${randomUUID()}`, displayName: 'Season creator' }
    })).id;
    leagueId = (await prisma.league.create({
      data: {
        name: `League ${randomUUID()}`,
        shortName: 'WIN',
        defaultPlatform: 'MOBILE',
        defaultServerRegion: 'CN',
        createdById: userId
      }
    })).id;
    seasonId = (await prisma.leagueSeason.create({
      data: {
        leagueId,
        seasonNumber: 1,
        displayName: 'S1',
        isFirstSeason: true,
        registrationOpensAt: new Date('2026-09-01T00:00:00.000Z'),
        registrationClosesAt: new Date('2026-09-05T00:00:00.000Z'),
        startsAt: new Date('2026-09-10T00:00:00.000Z'),
        endsAt: new Date('2026-10-10T00:00:00.000Z'),
        superCapacity: 23,
        championCapacity: 18,
        promotionCount: 4,
        createdById: userId
      }
    })).id;
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { leagueId } });
    await prisma.transferWindow.deleteMany({ where: { seasonId } });
    await prisma.leagueSeason.delete({ where: { id: seasonId } });
    await prisma.league.delete({ where: { id: leagueId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.adminAccount.delete({ where: { id: adminId } });
  });

  afterAll(() => prisma.$disconnect());

  const window = (name: string, startsAt: string, endsAt: string) => ({
    name,
    startsAt,
    endsAt,
    allowBuy: true,
    allowSell: false,
    allowTransfer: false,
    allowCardUpgrade: true
  });

  it('rejects overlapping windows but accepts adjacent half-open ranges', async () => {
    await service.create(adminId, seasonId, window(
      'First',
      '2026-09-10T00:00:00.000Z',
      '2026-09-20T00:00:00.000Z'
    ));
    await expect(service.create(adminId, seasonId, window(
      'Overlap',
      '2026-09-19T00:00:00.000Z',
      '2026-09-25T00:00:00.000Z'
    ))).rejects.toMatchObject({ code: 'TRANSFER_WINDOW_OVERLAP' });
    await expect(service.create(adminId, seasonId, window(
      'Adjacent',
      '2026-09-20T00:00:00.000Z',
      '2026-09-25T00:00:00.000Z'
    ))).resolves.toMatchObject({ name: 'Adjacent' });
  });

  it('uses inclusive start and exclusive end boundaries per operation', async () => {
    await service.create(adminId, seasonId, window(
      'Main',
      '2026-09-10T00:00:00.000Z',
      '2026-09-20T00:00:00.000Z'
    ));

    await expect(service.requireAllowed(seasonId, 'BUY', new Date('2026-09-10T00:00:00.000Z')))
      .resolves.toMatchObject({ name: 'Main' });
    await expect(service.requireAllowed(seasonId, 'CARD_UPGRADE', new Date('2026-09-19T23:59:59.999Z')))
      .resolves.toMatchObject({ name: 'Main' });
    await expect(service.requireAllowed(seasonId, 'SELL', new Date('2026-09-15T00:00:00.000Z')))
      .rejects.toMatchObject({ code: 'TRANSFER_OPERATION_NOT_ALLOWED' });
    await expect(service.requireAllowed(seasonId, 'BUY', new Date('2026-09-20T00:00:00.000Z')))
      .rejects.toMatchObject({ code: 'TRANSFER_WINDOW_CLOSED' });
  });

  it('requires the expected version when updating a window', async () => {
    const created = await service.create(adminId, seasonId, window(
      'Main',
      '2026-09-10T00:00:00.000Z',
      '2026-09-20T00:00:00.000Z'
    ));

    await expect(service.update(adminId, created.id, {
      ...window('Renamed', '2026-09-10T00:00:00.000Z', '2026-09-20T00:00:00.000Z'),
      expectedVersion: 2
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });
});
