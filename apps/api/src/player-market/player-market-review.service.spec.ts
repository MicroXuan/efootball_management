import { jest } from '@jest/globals';
import { PlayerMarketReviewService } from './player-market-review.service.js';

const at = new Date('2026-10-14T12:00:00.000Z');

function row(type: 'NORMAL_PURCHASE' | 'FORCED_TRANSFER' = 'NORMAL_PURCHASE') {
  return {
    id: 'app-1', leagueId: 'league-1', seasonId: 'season-1', transferWindowId: 'window-1', type,
    applicantLeagueTeamId: 'buyer', footballPlayerId: 'player-1', playerCardId: 'card-1',
    sourceLeagueTeamId: type === 'FORCED_TRANSFER' ? 'seller' : null,
    ownershipId: type === 'FORCED_TRANSFER' ? 'ownership-1' : null,
    ownershipVersionSnapshot: type === 'FORCED_TRANSFER' ? 3 : null,
    amountMinor: 700, valuationMinorSnapshot: 500, valuationVersionSnapshot: 1,
    status: 'PENDING', firstValidSubmittedAt: at, lastSubmittedAt: at,
    reviewedAt: null, reviewReason: null, version: 1,
    playerCard: { id: 'card-1', overallRating: 90, autoBuilds: [{ maxOverall: 95 }] }
  };
}

function harness(type: 'NORMAL_PURCHASE' | 'FORCED_TRANSFER' = 'NORMAL_PURCHASE') {
  let application = row(type);
  const ownership = {
    id: 'ownership-1', leagueId: 'league-1', leagueTeamId: 'seller', footballPlayerId: 'player-1',
    currentPlayerCardId: 'card-1', maxOverallSnapshot: 95, dtRatingSnapshot: 90,
    salaryRuleVersionId: 'salary-rule-1', salaryMinor: 300, acquisitionType: 'NORMAL',
    acquisitionSeasonId: null, acquiredAt: at, status: 'ACTIVE', version: 3
  };
  const tx = {
    $queryRaw: jest.fn(async () => []),
    playerAcquisitionApplication: {
      findUnique: jest.fn(async () => application),
      findMany: jest.fn(async (args?: { where?: { transferWindow?: unknown } }) => args?.where?.transferWindow ? [] : [application]),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        if (where.id !== application.id) return { ...row(), id: where.id, ...data } as never;
        application = { ...application, ...data, version: application.version + 1 } as never;
        return application;
      }),
      updateMany: jest.fn(async () => ({ count: 1 }))
    },
    transferWindow: { findUnique: jest.fn(async () => ({ seasonId: 'season-1', allowBuy: true, startsAt: new Date(at.getTime() - 1000), endsAt: new Date(at.getTime() + 1000) })) },
    leagueTeam: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, status: 'ACTIVE', rosterStatus: 'COMPLIANT', salaryCapMinor: 5000 })),
      updateMany: jest.fn(async () => ({ count: 1 }))
    },
    leaguePlayerOwnership: {
      findUnique: jest.fn(async () => type === 'FORCED_TRANSFER' ? ownership : null),
      count: jest.fn(async () => 10),
      aggregate: jest.fn(async () => ({ _sum: { salaryMinor: 1000 } })),
      create: jest.fn(async () => ({ ...ownership, id: 'ownership-new', leagueTeamId: 'buyer', version: 1 })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...ownership, ...data, leagueTeamId: 'buyer', version: 4 }))
    },
    leaguePlayerValuation: { findUnique: jest.fn(async () => ({ currentValueMinor: 500, version: 1 })) },
    rosterTransaction: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'transaction-1', ...data })) },
    financeLedgerEntry: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'ledger-1', ...data })) },
    playerAcquisitionApplicationEvent: { create: jest.fn(async () => ({ id: 'event-1' })) },
    auditLog: { create: jest.fn(async () => ({ id: 'audit-1' })) }
  };
  const prisma = {};
  const receipts = { execute: jest.fn(async (_admin: string, _op: string, _key: string, work: (client: typeof tx) => Promise<unknown>) => work(tx)) };
  const authorization = { requireLeagueManager: jest.fn(async () => ({ id: 'admin-1' })) };
  const locks = { lockApplication: jest.fn(async () => undefined), lockSeason: jest.fn(async () => undefined),
    lockPlayer: jest.fn(async () => undefined), lockTeam: jest.fn(async () => undefined),
    lockTeams: jest.fn(async () => undefined), lockApplicationsForPlayer: jest.fn(async () => undefined) };
  const rosterLocks = { lockTeams: jest.fn(async () => undefined) };
  const salaryRules = { quoteWithClient: jest.fn(async () => ({ salaryRuleVersionId: 'salary-rule-1', salaryMinor: 300, salaryCapMinor: 5000 })) };
  const audit = { record: jest.fn(async () => ({ id: 'audit-1' })) };
  const valuationSnapshots = {
    synchronizeSeasonBeforeRosterMutation:
      jest.fn<(tx: unknown, seasonId: string, clock: () => Date) => Promise<void>>()
        .mockResolvedValue(undefined)
  };
  const service = new PlayerMarketReviewService(prisma as never, receipts as never, authorization as never, locks as never, rosterLocks as never, salaryRules as never, audit as never, valuationSnapshots as never);
  return { service, tx, receipts, authorization, ownership, locks, rosterLocks, valuationSnapshots,
    setApplication: (value: ReturnType<typeof row>) => { application = value; } };
}

describe('PlayerMarketReviewService', () => {
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

      await service.approve(
        'admin-1',
        'app-1',
        { expectedVersion: 1, reason: '锁后时钟' },
        'post-lock-clock'
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('approves a selected normal application and closes rivals', async () => {
    const { service, tx, locks, rosterLocks, valuationSnapshots } = harness();
    const result = await service.approve('admin-1', 'app-1', { expectedVersion: 1, reason: '择优通过' }, 'key', at);
    expect(result).toMatchObject({ applicationId: 'app-1', status: 'APPROVED', transactionType: 'BUY' });
    expect(tx.leaguePlayerOwnership.create).toHaveBeenCalled();
    expect(tx.financeLedgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ direction: 'DEBIT', type: 'PLAYER_PURCHASE', amountMinor: 700 }) }));
    expect(tx.playerAcquisitionApplication.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'NOT_SELECTED' }) }));
    expect(valuationSnapshots.synchronizeSeasonBeforeRosterMutation).toHaveBeenCalledWith(tx, 'season-1', expect.any(Function));
    expect(valuationSnapshots.synchronizeSeasonBeforeRosterMutation.mock.invocationCallOrder[0])
      .toBeLessThan(locks.lockPlayer.mock.invocationCallOrder[0]!);
    expect(locks.lockPlayer.mock.invocationCallOrder[0]).toBeLessThan(rosterLocks.lockTeams.mock.invocationCallOrder[0]!);
    expect(rosterLocks.lockTeams.mock.invocationCallOrder[0]).toBeLessThan(locks.lockApplicationsForPlayer.mock.invocationCallOrder[0]!);
  });

  it('reactivates the existing released ownership row for a normal purchase', async () => {
    const { service, tx, ownership } = harness();
    tx.leaguePlayerOwnership.findUnique.mockResolvedValueOnce({ ...ownership, status: 'RELEASED' } as never);
    const result = await service.approve('admin-1', 'app-1', { expectedVersion: 1, reason: '重新签入' }, 'released', at);
    expect(tx.leaguePlayerOwnership.create).not.toHaveBeenCalled();
    expect(tx.leaguePlayerOwnership.update).toHaveBeenCalledWith({
      where: { id: ownership.id },
      data: expect.objectContaining({ leagueTeamId: 'buyer', status: 'ACTIVE', acquisitionType: 'NORMAL', version: { increment: 1 } })
    });
    expect(result).toMatchObject({ status: 'APPROVED', ownershipId: ownership.id });
  });

  it('settles a forced transfer with equal debit and credit while preserving player build and salary', async () => {
    const { service, tx, ownership } = harness('FORCED_TRANSFER');
    const result = await service.approve('admin-1', 'app-1', { expectedVersion: 1, reason: '队列首位' }, 'forced', at);
    expect(result).toMatchObject({ transactionType: 'FORCED_TRANSFER' });
    expect(tx.leaguePlayerOwnership.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      leagueTeamId: 'buyer', currentPlayerCardId: ownership.currentPlayerCardId,
      salaryMinor: ownership.salaryMinor, salaryRuleVersionId: ownership.salaryRuleVersionId,
      acquisitionType: 'FORCED_TRANSFER', acquisitionSeasonId: 'season-1'
    }) }));
    expect(tx.financeLedgerEntry.create).toHaveBeenCalledTimes(2);
    const ledgerCalls = tx.financeLedgerEntry.create.mock.calls.map(([call]) => call.data);
    expect(ledgerCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ leagueTeamId: 'buyer', direction: 'DEBIT', amountMinor: 700 }),
      expect.objectContaining({ leagueTeamId: 'seller', direction: 'CREDIT', amountMinor: 700 })
    ]));
  });

  it('recomputes both teams after a forced transfer against their own caps', async () => {
    const { service, tx } = harness('FORCED_TRANSFER');
    tx.leagueTeam.findUnique.mockImplementation(async ({ where }) => ({
      id: where.id, status: 'ACTIVE', rosterStatus: 'COMPLIANT',
      salaryCapMinor: where.id === 'seller' ? 100 : 5_000
    }));

    await expect(service.approve('admin-1', 'app-1', {
      expectedVersion: 1, reason: '分别重算工资帽'
    }, 'distinct-forced-caps', at)).resolves.toMatchObject({ status: 'APPROVED' });
    expect(tx.leagueTeam.updateMany).toHaveBeenCalledWith({
      where: { id: 'seller', rosterStatus: { not: 'OVER_CAP' } },
      data: { rosterStatus: 'OVER_CAP', version: { increment: 1 } }
    });
  });

  it('rejects a forced transfer that would cross the 5,000 salary cap', async () => {
    const { service, tx } = harness('FORCED_TRANSFER');
    tx.leaguePlayerOwnership.aggregate.mockResolvedValueOnce({ _sum: { salaryMinor: 4800 } });

    const result = await service.approve('admin-1', 'app-1', { expectedVersion: 1, reason: '工资帽复核' }, 'forced-cap', at);

    expect(result).toMatchObject({ status: 'INELIGIBLE', transactionId: null, ownershipId: null });
    expect(tx.leaguePlayerOwnership.update).not.toHaveBeenCalled();
    expect(tx.financeLedgerEntry.create).not.toHaveBeenCalled();
  });

  it.each(['NORMAL_PURCHASE', 'FORCED_TRANSFER'] as const)(
    'rejects %s when the applicant team cap is lower than the league rule cap', async (type) => {
      const { service, tx } = harness(type);
      tx.leagueTeam.findUnique.mockImplementation(async ({ where }) => ({
        id: where.id, status: 'ACTIVE', rosterStatus: 'COMPLIANT',
        salaryCapMinor: where.id === 'buyer' ? 1_200 : 5_000
      }));

      const result = await service.approve('admin-1', 'app-1', {
        expectedVersion: 1, reason: '逐队工资帽复核'
      }, `team-cap-${type}`, at);

      expect(result).toMatchObject({ status: 'INELIGIBLE', transactionId: null });
      expect(tx.financeLedgerEntry.create).not.toHaveBeenCalled();
    }
  );

  it('expires the selected application durably when its own transfer window has closed', async () => {
    const { service, tx } = harness();
    tx.transferWindow.findUnique.mockResolvedValueOnce({
      seasonId: 'season-1', allowBuy: true,
      startsAt: new Date(at.getTime() - 2_000), endsAt: at
    });

    await expect(service.approve('admin-1', 'app-1', {
      expectedVersion: 1, reason: '窗口已结束'
    }, 'closed-selected', at)).resolves.toMatchObject({ status: 'EXPIRED' });
    expect(tx.playerAcquisitionApplication.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'app-1' }, data: expect.objectContaining({ status: 'EXPIRED', reviewedAt: at })
    }));
  });

  it('enforces forced queue order', async () => {
    const { service, tx } = harness('FORCED_TRANSFER');
    tx.playerAcquisitionApplication.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { ...row('FORCED_TRANSFER'), id: 'earlier', firstValidSubmittedAt: new Date(at.getTime() - 1) },
        row('FORCED_TRANSFER')
      ] as never);
    await expect(service.approve('admin-1', 'app-1', { expectedVersion: 1, reason: '跳号' }, 'queue', at))
      .rejects.toMatchObject({ code: 'FORCED_QUEUE_ORDER_VIOLATION' });
  });

  it('expires closed-window rivals before evaluating the current forced-transfer queue', async () => {
    const { service, tx } = harness('FORCED_TRANSFER');
    const stale = {
      ...row('FORCED_TRANSFER'), id: 'stale-w1', transferWindowId: 'window-w1',
      firstValidSubmittedAt: new Date(at.getTime() - 10_000)
    };
    tx.playerAcquisitionApplication.findMany
      .mockResolvedValueOnce([stale] as never)
      .mockResolvedValueOnce([row('FORCED_TRANSFER')] as never);

    await expect(service.approve('admin-1', 'app-1', {
      expectedVersion: 1, reason: '新窗口队列首位'
    }, 'queue-new-window', at)).resolves.toMatchObject({ status: 'APPROVED' });

    expect(tx.playerAcquisitionApplication.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'stale-w1' },
      data: expect.objectContaining({ status: 'EXPIRED', reviewReason: 'TRANSFER_WINDOW_CLOSED' })
    }));
  });

  it('rejects without changing ownership or finance', async () => {
    const { service, tx } = harness();
    const result = await service.reject('admin-1', 'app-1', { expectedVersion: 1, reason: '报价不合适' }, 'reject');
    expect(result).toMatchObject({ applicationId: 'app-1', status: 'REJECTED' });
    expect(tx.leaguePlayerOwnership.create).not.toHaveBeenCalled();
    expect(tx.financeLedgerEntry.create).not.toHaveBeenCalled();
  });
});
