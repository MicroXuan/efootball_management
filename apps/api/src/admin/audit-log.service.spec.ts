import { jest } from '@jest/globals';
import { AuditLogService } from './audit-log.service.js';

describe('AuditLogService', () => {
  it('returns actor, league, and affected season display names without changing metadata', async () => {
    const metadata = { oldSeasonId: 'season-1', newSeasonId: 'season-2' };
    const prisma = {
      auditLog: {
        findMany: jest.fn(async () => [{
          id: 'log-1',
          actorAdminId: 'admin-1',
          actorAdmin: { displayName: '小宣' },
          actorUser: null,
          leagueId: 'league-1',
          league: { name: 'CELL 联赛' },
          action: 'admin.league-season.set-current',
          resourceType: 'League',
          resourceId: 'league-1',
          reason: null,
          metadata,
          createdAt: new Date('2026-10-02T00:00:00.000Z')
        }])
      },
      leagueSeason: {
        findMany: jest.fn(async () => [{ id: 'season-2', displayName: 'S2' }])
      }
    };
    const visibility = { requireVisible: jest.fn(async () => 'league-1') };
    const service = new AuditLogService(prisma as never, visibility as never);

    await expect(service.list()).resolves.toEqual([expect.objectContaining({
      actorDisplayName: '小宣',
      leagueName: 'CELL 联赛',
      subjectDisplayName: 'S2',
      metadata
    })]);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [
          { leagueId: null },
          { league: { isDeleted: false } }
        ]
      },
      include: {
        actorAdmin: { select: { displayName: true } },
        actorUser: { select: { displayName: true } },
        league: { select: { name: true } }
      }
    }));
  });

  it('checks a requested league before listing its audit records', async () => {
    const prisma = {
      auditLog: { findMany: jest.fn(async () => []) },
      leagueSeason: { findMany: jest.fn(async () => []) }
    };
    const visibility = { requireVisible: jest.fn(async () => 'league-1') };
    const service = new AuditLogService(prisma as never, visibility as never);

    await expect(service.list('league-1')).resolves.toEqual([]);

    expect(visibility.requireVisible).toHaveBeenCalledWith({ type: 'LEAGUE', id: 'league-1' });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { leagueId: 'league-1', league: { isDeleted: false } }
    }));
  });
});
