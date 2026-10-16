import { jest } from '@jest/globals';
import { TeamPlayerReleaseService } from './team-player-release.service.js';

const at = new Date('2026-10-14T12:00:00.000Z');

function harness() {
  const ownership = {
    id: 'ownership-1', leagueId: 'league-1', leagueTeamId: 'team-1', footballPlayerId: 'player-1',
    currentPlayerCardId: 'card-1', maxOverallSnapshot: 95, salaryRuleVersionId: 'rule-1', salaryMinor: 300,
    acquiredAt: at, acquisitionType: 'NORMAL', acquisitionSeasonId: null, status: 'ACTIVE', version: 2
  };
  const tx = {
    $queryRaw: jest.fn(async () => []),
    leagueTeam: {
      findUnique: jest.fn(async () => ({ id: 'team-1', status: 'ACTIVE' })),
      updateMany: jest.fn(async () => ({ count: 1 }))
    },
    transferWindow: { findUnique: jest.fn(async () => ({ id: 'window-1', seasonId: 'season-1', allowSell: true, startsAt: new Date(at.getTime() - 1000), endsAt: new Date(at.getTime() + 1000) })) },
    leaguePlayerOwnership: {
      findUnique: jest.fn(async () => ownership),
      update: jest.fn(async () => ({ ...ownership, status: 'RELEASED', version: 3 })),
      count: jest.fn(async () => 9),
      aggregate: jest.fn(async () => ({ _sum: { salaryMinor: 2700 } }))
    },
    leagueSalaryRuleVersion: { findFirst: jest.fn(async () => ({ salaryCapMinor: 5000 })) },
    rosterTransaction: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'transaction-1', ...data })) },
    playerReleaseRestriction: { create: jest.fn(async () => ({ id: 'restriction-1' })) },
    financeLedgerEntry: { create: jest.fn(async () => ({ id: 'should-not-exist' })) },
    auditLog: { create: jest.fn(async () => ({ id: 'audit-1' })) }
  };
  const receipts = { execute: jest.fn(async (_user: string, _op: string, _key: string, work: (client: typeof tx) => Promise<unknown>) => work(tx)) };
  const access = { requireOwnedTeam: jest.fn(async () => ({ leagueId: 'league-1', leagueTeamId: 'team-1' })) };
  const locks = { lockTeam: jest.fn(async () => undefined), lockPlayer: jest.fn(async () => undefined), lockTeams: jest.fn(async () => undefined) };
  const audit = { record: jest.fn(async () => ({ id: 'audit-1' })) };
  const valuationSnapshots = {
    synchronizeSeasonBeforeRosterMutation:
      jest.fn<(tx: unknown, seasonId: string, clock: () => Date) => Promise<void>>()
        .mockResolvedValue(undefined)
  };
  const service = new TeamPlayerReleaseService({} as never, receipts as never, access as never, locks as never, audit as never, valuationSnapshots as never);
  return { service, tx, access, locks, valuationSnapshots };
}

describe('TeamPlayerReleaseService', () => {
  it('evaluates valuation-window opening with the clock after waiting for the season lock', async () => {
    jest.useFakeTimers();
    try {
      const beforeLock = new Date('2026-10-14T12:00:00.000Z');
      const afterLock = new Date('2026-10-14T12:00:00.500Z');
      jest.setSystemTime(beforeLock);
      const { service, valuationSnapshots } = harness();
      valuationSnapshots.synchronizeSeasonBeforeRosterMutation.mockImplementationOnce(
        async (_tx: unknown, _seasonId: string, clock: () => Date) => {
          jest.setSystemTime(afterLock);
          expect(clock()).toEqual(afterLock);
        }
      );

      await service.release('user-1', 'team-1', {
        seasonId: 'season-1', transferWindowId: 'window-1', ownershipId: 'ownership-1',
        expectedVersion: 2, reason: '锁后时钟'
      }, 'post-lock-clock');
    } finally {
      jest.useRealTimers();
    }
  });

  it('releases immediately, records the restriction and user audit, and writes no finance entry', async () => {
    const { service, tx, locks, valuationSnapshots } = harness();
    const result = await service.release('user-1', 'team-1', {
      seasonId: 'season-1', transferWindowId: 'window-1', ownershipId: 'ownership-1', expectedVersion: 2, reason: '腾出名额'
    }, 'release-key', at);
    expect(result).toMatchObject({ ownership: { status: 'RELEASED', version: 3 }, transaction: { type: 'RELEASE', createdByUserId: 'user-1' }, summary: { rosterCount: 9, salaryMinor: 2700 } });
    expect(tx.playerReleaseRestriction.create).toHaveBeenCalled();
    expect(tx.financeLedgerEntry.create).not.toHaveBeenCalled();
    expect(tx.leagueTeam.updateMany).toHaveBeenCalledWith({
      where: { id: 'team-1', rosterStatus: { not: 'COMPLIANT' } },
      data: { rosterStatus: 'COMPLIANT', version: { increment: 1 } }
    });
    expect(valuationSnapshots.synchronizeSeasonBeforeRosterMutation).toHaveBeenCalledWith(tx, 'season-1', expect.any(Function));
    expect(valuationSnapshots.synchronizeSeasonBeforeRosterMutation.mock.invocationCallOrder[0])
      .toBeLessThan(locks.lockPlayer.mock.invocationCallOrder[0]!);
    expect(locks.lockPlayer.mock.invocationCallOrder[0]).toBeLessThan(locks.lockTeams.mock.invocationCallOrder[0]!);
  });

  it('rejects another owner, stale versions, inactive ownerships, and a closed sell window', async () => {
    const { service, tx, access } = harness();
    access.requireOwnedTeam.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { code: 'PLAYER_MARKET_TEAM_OWNER_REQUIRED' }));
    await expect(service.release('other', 'team-1', { seasonId: 'season-1', transferWindowId: 'window-1', ownershipId: 'ownership-1', expectedVersion: 2, reason: 'x' }, 'other', at))
      .rejects.toMatchObject({ code: 'PLAYER_MARKET_TEAM_OWNER_REQUIRED' });
    await expect(service.release('user-1', 'team-1', { seasonId: 'season-1', transferWindowId: 'window-1', ownershipId: 'ownership-1', expectedVersion: 1, reason: 'x' }, 'stale', at))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    const inactive = { ...(await tx.leaguePlayerOwnership.findUnique()), status: 'RELEASED' };
    tx.leaguePlayerOwnership.findUnique.mockResolvedValueOnce(inactive).mockResolvedValueOnce(inactive);
    await expect(service.release('user-1', 'team-1', { seasonId: 'season-1', transferWindowId: 'window-1', ownershipId: 'ownership-1', expectedVersion: 2, reason: 'x' }, 'inactive', at))
      .rejects.toMatchObject({ code: 'OWNERSHIP_NOT_ACTIVE' });
    tx.transferWindow.findUnique.mockResolvedValueOnce({ id: 'window-1', seasonId: 'season-1', allowSell: true, startsAt: new Date(at.getTime() - 1000), endsAt: at });
    await expect(service.release('user-1', 'team-1', { seasonId: 'season-1', transferWindowId: 'window-1', ownershipId: 'ownership-1', expectedVersion: 2, reason: 'x' }, 'closed', at))
      .rejects.toMatchObject({ code: 'TRANSFER_WINDOW_CLOSED' });
  });
});
