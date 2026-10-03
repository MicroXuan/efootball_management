import { jest } from '@jest/globals';
import { ValuationSnapshotsService } from './valuation-snapshots.service.js';

const at = new Date('2026-10-03T12:00:00.000Z');

function harness() {
  const rule = {
    id: 'rule-1', windowId: 'window-1', version: 1,
    minimumValueMinor: 100, maximumValueMinor: 10_000,
    maximumIncreaseBps: 2000, maximumDecreaseBps: 1000,
    createdByAdminId: 'admin-1', createdAt: at
  };
  const window = {
    id: 'window-1', seasonId: 'season-1', name: '季前申报', state: 'OPEN' as const,
    startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-10-08T00:00:00.000Z',
    closedAt: null, currentRule: { ...rule, createdAt: at.toISOString() },
    createdByAdminId: 'admin-1', version: 1,
    createdAt: at.toISOString(), updatedAt: at.toISOString()
  };
  const ownership = {
    id: 'ownership-1', leagueId: 'league-1', leagueTeamId: 'team-1',
    footballPlayerId: 'player-1', status: 'ACTIVE',
    footballPlayer: { id: 'player-1', nameZh: '测试球员', nameEn: null, shortName: null },
    currentPlayerCard: { cardName: '精选卡', imageUrl: null }
  };
  const snapshot = {
    id: 'snapshot-1', windowId: 'window-1', leagueTeamId: 'team-1',
    ownershipId: ownership.id, footballPlayerId: ownership.footballPlayerId,
    baseValueMinor: 1000, createdAt: at,
    ownership
  };
  const snapshotFindMany = jest.fn<() => Promise<unknown[]>>()
    .mockResolvedValueOnce([])
    .mockResolvedValue([snapshot]);
  const tx = {
    $queryRaw: jest.fn(async () => [{ id: window.id }]),
    valuationWindow: {
      findUniqueOrThrow: jest.fn<() => Promise<{ id: string; snapshotInitializedAt: Date | null }>>(async () => ({ id: window.id, snapshotInitializedAt: null })),
      update: jest.fn(async () => ({ id: window.id, snapshotInitializedAt: at }))
    },
    valuationRosterSnapshot: {
      findMany: snapshotFindMany,
      createMany: jest.fn(async () => ({ count: 1 }))
    },
    seasonEntry: { findMany: jest.fn(async () => [{ leagueTeamId: 'team-1' }]) },
    leaguePlayerOwnership: { findMany: jest.fn<() => Promise<unknown[]>>(async () => [ownership]) },
    leaguePlayerValuation: { findMany: jest.fn(async () => [{ footballPlayerId: 'player-1', currentValueMinor: 1000 }]) }
  };
  const prisma = {
    $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    leagueTeam: { findUnique: jest.fn<() => Promise<{ id: string; name: string; ownerUserId: string; leagueId: string } | null>>(async () => ({ id: 'team-1', name: '海港竞技', ownerUserId: 'user-1', leagueId: 'league-1' })) },
    seasonEntry: { findFirst: jest.fn<() => Promise<{ id: string; status: string } | null>>(async () => ({ id: 'entry-1', status: 'APPROVED' })) },
    valuationWindow: { findFirst: jest.fn(async () => ({ id: 'window-1' })) },
    valuationSubmission: { findFirst: jest.fn(async () => null) },
    leaguePlayerValuation: { findMany: jest.fn(async () => [{ footballPlayerId: 'player-1', currentValueMinor: 1200 }]) }
  };
  const windows = { getEffectiveRule: jest.fn(async () => ({ window, rule, leagueId: 'league-1' })) };
  const service = new ValuationSnapshotsService(prisma as never, windows as never);
  return { service, prisma, tx, windows, window, rule, ownership, snapshot };
}

describe('ValuationSnapshotsService', () => {
  it('locks the approved teams active roster once and remains idempotent', async () => {
    const { service, tx, snapshot } = harness();
    await expect(service.ensureWindowSnapshot('window-1', at)).resolves.toEqual([snapshot]);
    await expect(service.ensureWindowSnapshot('window-1', at)).resolves.toEqual([snapshot]);
    expect(tx.valuationRosterSnapshot.createMany).toHaveBeenCalledTimes(1);
    expect(tx.valuationRosterSnapshot.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        windowId: 'window-1', leagueTeamId: 'team-1', footballPlayerId: 'player-1', baseValueMinor: 1000
      })],
      skipDuplicates: true
    });
  });

  it('remembers an empty snapshot so later signings cannot enter the same window', async () => {
    const { service, tx } = harness();
    tx.valuationRosterSnapshot.findMany.mockReset();
    tx.valuationRosterSnapshot.findMany.mockResolvedValue([]);
    tx.leaguePlayerOwnership.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'late-signing' }]);
    tx.valuationWindow.findUniqueOrThrow
      .mockResolvedValueOnce({ id: 'window-1', snapshotInitializedAt: null })
      .mockResolvedValueOnce({ id: 'window-1', snapshotInitializedAt: at });

    await service.ensureWindowSnapshot('window-1', at);
    await service.ensureWindowSnapshot('window-1', at);
    expect(tx.leaguePlayerOwnership.findMany).toHaveBeenCalledTimes(1);
    expect(tx.valuationWindow.update).toHaveBeenCalledWith({
      where: { id: 'window-1' }, data: { snapshotInitializedAt: at }
    });
  });

  it('does not move a snapshotted player when the ownership transfers later', async () => {
    const { service, tx, ownership } = harness();
    const first = await service.ensureWindowSnapshot('window-1', at);
    ownership.leagueTeamId = 'team-2';
    const second = await service.ensureWindowSnapshot('window-1', at);
    expect(first[0]?.leagueTeamId).toBe('team-1');
    expect(second[0]?.leagueTeamId).toBe('team-1');
    expect(tx.valuationRosterSnapshot.createMany).toHaveBeenCalledTimes(1);
  });

  it('rejects non-owners and users without an approved season entry', async () => {
    const { service, prisma } = harness();
    await expect(service.getWorkspace('other-user', 'team-1', at)).rejects.toMatchObject({
      code: 'VALUATION_TEAM_OWNER_REQUIRED'
    });
    prisma.leagueTeam.findUnique.mockResolvedValueOnce({ id: 'team-1', name: '海港竞技', ownerUserId: 'user-1', leagueId: 'league-1' });
    prisma.seasonEntry.findFirst.mockResolvedValueOnce(null);
    await expect(service.getWorkspace('user-1', 'team-1', at)).rejects.toMatchObject({
      code: 'VALUATION_SEASON_ENTRY_REQUIRED'
    });
  });

  it('returns the snapshot roster while keeping the players current league valuation', async () => {
    const { service, snapshot, prisma } = harness();
    jest.spyOn(service, 'ensureWindowSnapshot').mockResolvedValueOnce([snapshot] as never);
    const workspace = await service.getWorkspace('user-1', 'team-1', at);
    expect(prisma.valuationWindow.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ season: { leagueId: 'league-1' } })
    }));
    expect(workspace.players).toEqual([expect.objectContaining({
      playerId: 'player-1',
      baseValueMinor: 1000,
      currentValueMinor: 1200,
      minimumAllowedMinor: 900,
      maximumAllowedMinor: 1200
    })]);
  });
});
