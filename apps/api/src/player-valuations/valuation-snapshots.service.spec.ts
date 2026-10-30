import { Logger } from '@nestjs/common';
import { jest } from '@jest/globals';
import { BackgroundActivity } from '../common/scheduling/background-activity.js';
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
      findMany: jest.fn(async () => [] as Array<{
        id: string;
        seasonId: string;
        season: { leagueId: string };
      }>),
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
    valuationWindow: {
      findFirst: jest.fn(async () => ({ id: 'window-1' })),
      findMany: jest.fn(async () => [] as Array<{ id: string }>)
    },
    valuationSubmission: { findFirst: jest.fn(async () => null) },
    leaguePlayerValuation: { findMany: jest.fn(async () => [{ footballPlayerId: 'player-1', currentValueMinor: 1200 }]) }
  };
  const windows = { activity: new BackgroundActivity(), getEffectiveRule: jest.fn(async () => ({ window, rule, leagueId: 'league-1' })) };
  const service = new ValuationSnapshotsService(prisma as never, windows as never, {
    requireVisible: jest.fn(async () => 'league-1')
  } as never);
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

  it('initializes scheduled windows when server time reaches their opening', async () => {
    const { service, prisma } = harness();
    prisma.valuationWindow.findMany.mockResolvedValueOnce([{ id: 'window-1' }]);
    const ensure = jest.spyOn(service, 'ensureWindowSnapshot').mockResolvedValueOnce([]);
    await service.initializeDueWindows(at);
    expect(ensure).toHaveBeenCalledWith('window-1', at);
  });

  it('locks the season windows before evaluating the opening boundary and mutating a roster', async () => {
    const { service, tx } = harness();
    tx.valuationWindow.findMany.mockResolvedValueOnce([{
      id: 'window-1',
      seasonId: 'season-1',
      season: { leagueId: 'league-1' }
    }]);
    const boundaryClock = jest.fn(() => {
      expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
      return at;
    });

    await service.synchronizeSeasonBeforeRosterMutation(tx as never, 'season-1', boundaryClock);

    expect(boundaryClock).toHaveBeenCalledTimes(1);
    expect(tx.valuationRosterSnapshot.createMany).toHaveBeenCalledTimes(1);
    expect(tx.valuationWindow.update).toHaveBeenCalledWith({
      where: { id: 'window-1' },
      data: { snapshotInitializedAt: at }
    });
  });

  it('adds a late signing to an already initialized open window', async () => {
    const { service, tx, ownership, snapshot } = harness();
    const lateOwnership = {
      ...ownership,
      id: 'ownership-2',
      footballPlayerId: 'player-2',
      footballPlayer: { ...ownership.footballPlayer, id: 'player-2', nameZh: '新签球员' }
    };
    const lateSnapshot = {
      ...snapshot,
      id: 'snapshot-2',
      ownershipId: lateOwnership.id,
      footballPlayerId: lateOwnership.footballPlayerId,
      baseValueMinor: null,
      ownership: lateOwnership
    };
    tx.valuationRosterSnapshot.findMany.mockReset();
    tx.valuationRosterSnapshot.findMany
      .mockResolvedValueOnce([snapshot])
      .mockResolvedValueOnce([snapshot, lateSnapshot]);
    tx.leaguePlayerOwnership.findMany.mockResolvedValueOnce([ownership, lateOwnership]);
    tx.leaguePlayerValuation.findMany.mockResolvedValueOnce([
      { footballPlayerId: 'player-1', currentValueMinor: 1000 }
    ]);
    tx.valuationWindow.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'window-1', snapshotInitializedAt: at
    });

    const result = await service.ensureWindowSnapshot('window-1', at);

    expect(result.map((row) => row.footballPlayerId)).toEqual(['player-1', 'player-2']);
    expect(tx.leaguePlayerOwnership.findMany).toHaveBeenCalledTimes(1);
    expect(tx.valuationRosterSnapshot.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        windowId: 'window-1', leagueTeamId: 'team-1', ownershipId: 'ownership-2',
        footballPlayerId: 'player-2', baseValueMinor: null
      })],
      skipDuplicates: true
    });
  });

  it('returns a transferred player only for the current team while preserving the old snapshot', async () => {
    const { service, tx, ownership, snapshot } = harness();
    const movedOwnership = { ...ownership, leagueTeamId: 'team-2' };
    const movedSnapshot = {
      ...snapshot,
      id: 'snapshot-2',
      leagueTeamId: 'team-2',
      ownership: movedOwnership
    };
    const historicalSnapshot = { ...snapshot, ownership: movedOwnership };
    tx.seasonEntry.findMany.mockResolvedValueOnce([
      { leagueTeamId: 'team-1' }, { leagueTeamId: 'team-2' }
    ]);
    tx.leaguePlayerOwnership.findMany.mockResolvedValueOnce([movedOwnership]);
    tx.valuationRosterSnapshot.findMany.mockReset();
    tx.valuationRosterSnapshot.findMany
      .mockResolvedValueOnce([historicalSnapshot])
      .mockResolvedValueOnce([historicalSnapshot, movedSnapshot]);
    tx.valuationWindow.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'window-1', snapshotInitializedAt: at
    });

    const current = await service.ensureWindowSnapshot('window-1', at);

    expect(current).toEqual([movedSnapshot]);
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

describe('ValuationSnapshotsService background scheduling', () => {
  afterEach(() => jest.useRealTimers());

  it('does not query empty windows every second', async () => {
    jest.useFakeTimers();
    const { service, prisma } = harness();
    prisma.valuationWindow.findFirst.mockResolvedValue(null as never);
    service.onApplicationBootstrap();
    try {
      await jest.advanceTimersByTimeAsync(60_000);
      expect(prisma.valuationWindow.findMany.mock.calls.length).toBeLessThanOrEqual(3);
      expect(prisma.valuationWindow.findMany.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally { service.onApplicationShutdown(); }
  });

  it('reacts to a window edit while an earlier background read is in flight', async () => {
    jest.useFakeTimers();
    const { service, prisma, windows } = harness();
    let finish!: (rows: Array<{ id: string }>) => void;
    prisma.valuationWindow.findMany.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    prisma.valuationWindow.findFirst.mockResolvedValue(null as never);
    service.onApplicationBootstrap();
    try {
      await jest.advanceTimersByTimeAsync(5_000);
      expect(prisma.valuationWindow.findMany).toHaveBeenCalledTimes(1);
      windows.activity.wake();
      finish([]);
      await jest.advanceTimersByTimeAsync(1_000);
      expect(prisma.valuationWindow.findMany).toHaveBeenCalledTimes(2);
      await service.onApplicationShutdown();
      await jest.advanceTimersByTimeAsync(60_000);
      expect(prisma.valuationWindow.findMany).toHaveBeenCalledTimes(2);
    } finally { await service.onApplicationShutdown(); }
  });

  it('waits for pending work on shutdown without starting another scan', async () => {
    jest.useFakeTimers();
    const { service, prisma } = harness();
    let finish!: (rows: Array<{ id: string }>) => void;
    prisma.valuationWindow.findMany.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    prisma.valuationWindow.findFirst.mockResolvedValue(null as never);
    service.onApplicationBootstrap();
    let stopped = false;
    const shutdown = service.onApplicationShutdown().then(() => { stopped = true; });
    await jest.advanceTimersByTimeAsync(5_000);
    expect(stopped).toBe(false);
    finish([]);
    await shutdown;
    await jest.advanceTimersByTimeAsync(30_000);
    expect(prisma.valuationWindow.findMany).toHaveBeenCalledTimes(1);
  });

  it('retries initialization after a transient database failure', async () => {
    jest.useFakeTimers();
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { service, prisma } = harness();
    prisma.valuationWindow.findMany.mockRejectedValueOnce(new Error('temporary database failure'));
    prisma.valuationWindow.findFirst.mockResolvedValue(null as never);
    service.onApplicationBootstrap();
    try {
      await jest.advanceTimersByTimeAsync(1_000);
      expect(prisma.valuationWindow.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.valuationWindow.findFirst).toHaveBeenCalledTimes(1);
    } finally { await service.onApplicationShutdown(); log.mockRestore(); }
  });

  it('checks at the next scheduled opening instead of waiting for the reconciliation interval', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(at);
    const { service, prisma } = harness();
    prisma.valuationWindow.findFirst.mockResolvedValue({ id: 'window-1', startsAt: new Date(at.getTime() + 7_000) } as never);
    prisma.valuationWindow.findMany.mockImplementation(async () => Date.now() >= at.getTime() + 7_000 ? [{ id: 'window-1' }] : []);
    const ensure = jest.spyOn(service, 'ensureWindowSnapshot').mockResolvedValue([]);
    service.onApplicationBootstrap();
    try {
      await jest.advanceTimersByTimeAsync(6_999);
      expect(prisma.valuationWindow.findMany).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(prisma.valuationWindow.findMany).toHaveBeenCalledTimes(2);
      expect(ensure).toHaveBeenCalledWith('window-1', new Date(at.getTime() + 7_000));
      expect(prisma.valuationWindow.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ closedAt: null, snapshotInitializedAt: null, startsAt: { gt: at } }),
        orderBy: { startsAt: 'asc' }
      }));
    } finally { await service.onApplicationShutdown(); }
  });
});
