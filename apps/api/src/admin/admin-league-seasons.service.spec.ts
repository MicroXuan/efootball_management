import { jest } from '@jest/globals';
import { AdminError } from './admin.errors.js';
import { AdminLeagueSeasonsService } from './admin-league-seasons.service.js';

function harness(overrides: Record<string, unknown> = {}) {
  const leagueFind = jest.fn(async () => ({
    id: 'league-1', currentSeasonId: 'season-old', version: 2, edition: 'INTERNATIONAL'
  }));
  const seasonFind = jest.fn<() => Promise<Record<string, unknown> | null>>(async () => ({
    id: 'season-20', leagueId: 'league-1', version: 4, displayName: 'S20', status: 'DRAFT'
  }));
  const transaction = {
    $queryRaw: jest.fn(async () => []),
    league: {
      findUnique: leagueFind,
      findFirst: leagueFind,
      updateMany: jest.fn(async () => ({ count: 1 }))
    },
    leagueSeason: {
      findUnique: seasonFind,
      findFirst: seasonFind,
      updateMany: jest.fn(async () => ({ count: 1 }))
    },
    leagueTeam: { findMany: jest.fn<() => Promise<unknown[]>>(async () => []) },
    valuationWindow: { findMany: jest.fn(async () => []) },
    seasonEntry: {
      createMany: jest.fn(async () => ({ count: 0 })),
      count: jest.fn(async () => 0)
    },
    ...overrides
  };
  const authorization = { requireLeagueAccess: jest.fn(async () => ({ id: 'admin-1' })) };
  const audit = { record: jest.fn(async () => undefined) };
  const receipts = {
    execute: jest.fn(async (
      _actor: string,
      _operation: string,
      _key: string,
      work: (value: typeof transaction) => Promise<unknown>
    ) => work(transaction))
  };
  const service = new AdminLeagueSeasonsService(
    {} as never,
    authorization as never,
    receipts as never,
    audit as never
  );
  return { service, transaction, authorization, audit };
}

describe('AdminLeagueSeasonsService', () => {
  it('renames an opened season and records a specific audit action', async () => {
    const { service, transaction, audit } = harness();
    const opened = {
      id: 'season-20', leagueId: 'league-1', seasonNumber: 20, displayName: 'S20',
      previousSeasonId: null, isFirstSeason: false,
      registrationOpensAt: new Date('2026-01-01T00:00:00.000Z'),
      registrationClosesAt: new Date('2026-01-02T00:00:00.000Z'),
      startsAt: new Date('2026-01-03T00:00:00.000Z'), endsAt: new Date('2026-02-03T00:00:00.000Z'),
      superCapacity: 23, championCapacity: 18, promotionCount: 4,
      status: 'REGISTRATION_OPEN' as const, version: 4,
      createdAt: new Date('2025-12-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      createdById: null, createdByAdminId: 'admin-1',
    };
    transaction.leagueSeason.findUnique
      .mockResolvedValueOnce(opened)
      .mockResolvedValueOnce({
        ...opened, displayName: 'S20 正式赛季', version: 5,
        _count: { entries: 0 }, entries: [],
      });

    await expect(service.update('admin-1', 'league-1', 'season-20', {
      displayName: 'S20 正式赛季', expectedVersion: 4,
    }, 'rename-season-1')).resolves.toMatchObject({
      displayName: 'S20 正式赛季', status: 'REGISTRATION_OPEN', version: 5,
    });

    expect(transaction.leagueSeason.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ displayName: 'S20 正式赛季' }),
    }));
    expect(audit.record).toHaveBeenCalledWith(transaction, expect.objectContaining({
      action: 'admin.league-season.rename',
      metadata: { displayName: 'S20 正式赛季' },
    }));
  });

  it('switches only to a season in the same league without automatically enrolling teams', async () => {
    const { service, transaction, audit } = harness();

    await expect(service.setCurrent(
      'admin-1', 'league-1', 'season-20', { expectedVersion: 2 }, 'set-current-1'
    )).resolves.toMatchObject({ currentSeasonId: 'season-20', version: 3 });

    expect(transaction.seasonEntry.createMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(transaction, expect.objectContaining({
      metadata: { oldSeasonId: 'season-old', newSeasonId: 'season-20' }
    }));
  });

  it('rejects a current season belonging to another league', async () => {
    const { service, transaction } = harness();
    transaction.leagueSeason.findUnique.mockResolvedValue({
      id: 'season-20', leagueId: 'league-2', version: 4, displayName: 'S20', status: 'DRAFT'
    });

    await expect(service.setCurrent(
      'admin-1', 'league-1', 'season-20', { expectedVersion: 2 }, 'set-current-2'
    )).rejects.toMatchObject({ code: 'SEASON_NOT_IN_LEAGUE' });
  });

  it('detects optimistic conflicts while setting the current season', async () => {
    const { service, transaction } = harness();
    transaction.league.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.setCurrent(
      'admin-1', 'league-1', 'season-20', { expectedVersion: 1 }, 'set-current-3'
    )).rejects.toBeInstanceOf(AdminError);
  });

  it('enrolls only same-league teams idempotently and returns the approved participant count', async () => {
    const { service, transaction } = harness();
    transaction.leagueTeam.findMany.mockResolvedValue([
      { id: 'team-1', leagueId: 'league-1', ownerUserId: 'user-1', name: '申花', shortName: '申花', teamNumber: 25, logoUrl: null },
      { id: 'team-2', leagueId: 'league-1', ownerUserId: 'user-2', name: '国安', shortName: '国安', teamNumber: 12, logoUrl: null }
    ]);
    transaction.seasonEntry.createMany.mockResolvedValue({ count: 1 });
    transaction.seasonEntry.count.mockResolvedValue(2);

    await expect(service.enrollTeams('admin-1', 'league-1', 'season-20', {
      leagueTeamIds: ['team-1', 'team-2'],
      expectedSeasonVersion: 4
    }, 'enroll-1')).resolves.toMatchObject({ enrolledCount: 1, approvedEntryCount: 2 });

    expect(transaction.seasonEntry.createMany).toHaveBeenCalledWith(expect.objectContaining({
      skipDuplicates: true,
      data: expect.arrayContaining([expect.objectContaining({
        leagueTeamId: 'team-1',
        source: 'RENEWAL',
        status: 'APPROVED',
        leagueEditionSnapshot: 'INTERNATIONAL'
      })])
    }));
  });

  it('rejects requested teams that are not active members of the league', async () => {
    const { service, transaction } = harness();
    transaction.leagueTeam.findMany.mockResolvedValue([{ id: 'team-1' }]);

    await expect(service.enrollTeams('admin-1', 'league-1', 'season-20', {
      leagueTeamIds: ['team-1', 'team-foreign'],
      expectedSeasonVersion: 4
    }, 'enroll-2')).rejects.toMatchObject({ code: 'LEAGUE_TEAM_INVALID' });
  });
});
