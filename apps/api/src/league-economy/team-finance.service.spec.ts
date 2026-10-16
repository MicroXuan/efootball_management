import { jest } from '@jest/globals';
import { TeamFinanceService } from './team-finance.service.js';

const at = new Date('2026-10-02T12:00:00.000Z');

function harness(settlementEntries: Array<Record<string, unknown>> = []) {
  const team = { id: 'team-1', leagueId: 'league-1', ownerUserId: 'user-1', league: { currentSeasonId: 'season-1' as string | null } };
  const season = { id: 'season-1', leagueId: 'league-1' };
  const entries = [
    { id: 'credit-1', leagueId: 'league-1', leagueTeamId: 'team-1', seasonId: 'season-1', rosterTransactionId: null, direction: 'CREDIT', type: 'AUCTION', amountMinor: 2000, note: '拍卖收入', createdAt: at },
    { id: 'debit-1', leagueId: 'league-1', leagueTeamId: 'team-1', seasonId: 'season-1', rosterTransactionId: null, direction: 'DEBIT', type: 'LUXURY_TAX', amountMinor: 600, note: '奢侈税', createdAt: at }
  ];
  const tx = {
    $queryRaw: jest.fn(async () => []),
    leagueTeam: { findFirst: jest.fn(async () => team) },
    leagueSeason: { findFirst: jest.fn(async () => season) },
    financeLedgerEntry: {
      findMany: jest.fn(async () => settlementEntries),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: `entry-${String(data.settlementCategory ?? 'new')}`, createdAt: at, ...data }))
    }
  };
  const prisma = {
    leagueTeam: { findUnique: jest.fn(async () => team) },
    leagueSeason: { findFirst: jest.fn(async () => season) },
    seasonEntry: { findFirst: jest.fn<() => Promise<{ id: string } | null>>(async () => ({ id: 'entry-1' })) },
    financeLedgerEntry: { findMany: jest.fn(async () => entries) }
  };
  const authorization = { requireLeagueManager: jest.fn(async () => undefined) };
  const receipts = { execute: jest.fn(async (_admin: string, _operation: string, _key: string, work: (client: typeof tx) => Promise<unknown>) => work(tx)) };
  const audit = { record: jest.fn(async () => undefined) };
  const visibility = { requireVisible: jest.fn(async () => 'league-1') };
  return {
    service: new TeamFinanceService(
      prisma as never,
      authorization as never,
      receipts as never,
      audit as never,
      visibility as never
    ),
    prisma, tx, authorization, receipts, audit, visibility, team
  };
}

describe('TeamFinanceService', () => {
  it('creates an immutable reasoned manual entry for an authorized league administrator', async () => {
    const { service, authorization, tx, audit } = harness();
    const result = await service.createManualEntry('admin-1', 'league-1', {
      leagueTeamId: 'team-1', seasonId: 'season-1', direction: 'DEBIT', type: 'LUXURY_TAX',
      amountMinor: 600, note: '赛季奢侈税', reason: '按赛季规则计入'
    }, 'finance-key');
    expect(authorization.requireLeagueManager).toHaveBeenCalledWith('admin-1', 'league-1');
    expect(tx.financeLedgerEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      rosterTransactionId: null, direction: 'DEBIT', type: 'LUXURY_TAX', amountMinor: 600
    }) });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'FINANCE_MANUAL_ENTRY_CREATED', reason: '按赛季规则计入'
    }));
    expect(result).toMatchObject({ id: 'entry-new', amountMinor: 600 });
  });

  it('summarizes credits and debits in real time and keeps seasonless history separate', async () => {
    const { service, prisma, team } = harness();
    await expect(service.getSeasonSummary('user-1', 'team-1', 'season-1')).resolves.toMatchObject({
      seasonId: 'season-1', creditTotalMinor: 2000, debitTotalMinor: 600, balanceMinor: 1400,
      uncategorizedEntryCount: 0
    });
    expect(prisma.financeLedgerEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { leagueTeamId: 'team-1', seasonId: 'season-1' }
    }));
    await expect(service.getSeasonSummary('user-1', 'team-1', null)).resolves.toMatchObject({
      seasonId: 'season-1', creditTotalMinor: 2000, debitTotalMinor: 600
    });
    prisma.leagueTeam.findUnique.mockResolvedValueOnce({ ...team, league: { currentSeasonId: null } });
    prisma.financeLedgerEntry.findMany.mockResolvedValueOnce([{
      id: 'legacy', leagueId: 'league-1', leagueTeamId: 'team-1', seasonId: null,
      rosterTransactionId: null, direction: 'DEBIT', type: 'MANUAL_ADJUSTMENT',
      amountMinor: 50, note: '旧流水', createdAt: at
    }] as never);
    await expect(service.getSeasonSummary('user-1', 'team-1', null)).resolves.toMatchObject({
      seasonId: null, uncategorizedEntryCount: 1
    });
  });

  it('writes audited debit deltas for current settlement targets', async () => {
    const { service, tx, receipts, audit } = harness();
    const result = await service.upsertSettlement('admin-1', 'league-1', {
      leagueTeamId: 'team-1', seasonId: 'season-1',
      amounts: {
        transactionAmountMinor: 10, luxuryTaxMinor: 404, offseasonFeeMinor: 0,
        unfinishedMatchPenaltyMinor: 0, playerAuctionMinor: 0, teamAuctionMinor: 0,
        rookieSelectionMinor: 0, installmentPaymentMinor: 0, otherAdjustmentMinor: 0
      },
      note: '实时结算', reason: '管理员核对'
    }, 'settlement-key');

    expect(receipts.execute).toHaveBeenCalledWith(
      'admin-1', 'finance-settlement.upsert:league-1:team-1:season-1', 'settlement-key',
      expect.any(Function), expect.any(Object)
    );
    expect(tx.financeLedgerEntry.create).toHaveBeenCalledTimes(2);
    expect(tx.financeLedgerEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      direction: 'DEBIT', settlementCategory: 'LUXURY_TAX', amountMinor: 404
    }) });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'FINANCE_SETTLEMENT_UPDATED', resourceId: 'team-1', reason: '管理员核对'
    }));
    expect(result).toMatchObject({ totalMinor: 414 });
    expect(result.items).toHaveLength(9);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.financeLedgerEntry.findMany.mock.invocationCallOrder[0]!);
  });

  it('serializes concurrent settlement saves so the same target is charged once', async () => {
    const entries: Array<Record<string, unknown>> = [];
    let releaseLock: (() => void) | null = null;
    let held = false;
    const transactions = Array.from({ length: 2 }, () => ({
      $queryRaw: jest.fn(async () => {
        if (held) await new Promise<void>((resolve) => { releaseLock = resolve; });
        held = true;
        return [];
      }),
      financeLedgerEntry: {
        findMany: jest.fn(async () => entries.map((entry) => ({ ...entry }))),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          entries.push(data);
          return { id: `entry-${entries.length}`, createdAt: at, ...data };
        })
      }
    }));
    let next = 0;
    const receipts = { execute: jest.fn(async (_admin: string, _op: string, _key: string, work: (tx: typeof transactions[number]) => Promise<unknown>) => {
      const tx = transactions[next++]!;
      try { return await work(tx); } finally { held = false; releaseLock?.(); releaseLock = null; }
    }) };
    const scope = harness();
    const service = new TeamFinanceService(scope.prisma as never, scope.authorization as never, receipts as never,
      scope.audit as never, scope.visibility as never);
    const request = {
      leagueTeamId: 'team-1', seasonId: 'season-1',
      amounts: { transactionAmountMinor: 0, luxuryTaxMinor: 500, offseasonFeeMinor: 0,
        unfinishedMatchPenaltyMinor: 0, playerAuctionMinor: 0, teamAuctionMinor: 0,
        rookieSelectionMinor: 0, installmentPaymentMinor: 0, otherAdjustmentMinor: 0 },
      note: '并发结算', reason: '并发复核'
    };
    await Promise.all([
      service.upsertSettlement('admin-1', 'league-1', request, 'concurrent-a'),
      service.upsertSettlement('admin-1', 'league-1', request, 'concurrent-b')
    ]);
    expect(entries).toEqual([expect.objectContaining({ settlementCategory: 'LUXURY_TAX', amountMinor: 500 })]);
  });

  it('creates no rows for unchanged targets and credits a reduced target', async () => {
    const existing = [
      { direction: 'DEBIT', settlementCategory: 'TRANSACTION_AMOUNT', amountMinor: 10 },
      { direction: 'DEBIT', settlementCategory: 'LUXURY_TAX', amountMinor: 404 }
    ];
    const unchanged = harness(existing);
    const input = {
      leagueTeamId: 'team-1', seasonId: 'season-1',
      amounts: {
        transactionAmountMinor: 10, luxuryTaxMinor: 404, offseasonFeeMinor: 0,
        unfinishedMatchPenaltyMinor: 0, playerAuctionMinor: 0, teamAuctionMinor: 0,
        rookieSelectionMinor: 0, installmentPaymentMinor: 0, otherAdjustmentMinor: 0
      },
      note: '', reason: '复核无变化'
    } as const;
    await unchanged.service.upsertSettlement('admin-1', 'league-1', input, 'unchanged');
    expect(unchanged.tx.financeLedgerEntry.create).not.toHaveBeenCalled();

    const reduced = harness(existing);
    await reduced.service.upsertSettlement('admin-1', 'league-1', {
      ...input, amounts: { ...input.amounts, luxuryTaxMinor: 300 }, reason: '下调税额'
    }, 'reduced');
    expect(reduced.tx.financeLedgerEntry.create).toHaveBeenCalledTimes(1);
    expect(reduced.tx.financeLedgerEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      direction: 'CREDIT', settlementCategory: 'LUXURY_TAX', amountMinor: 104
    }) });
  });

  it('aggregates categorized rows for owner summaries without counting legacy rows', async () => {
    const { service, prisma } = harness();
    prisma.financeLedgerEntry.findMany.mockResolvedValueOnce([
      { id: 'tax-debit', leagueId: 'league-1', leagueTeamId: 'team-1', seasonId: 'season-1', rosterTransactionId: null, direction: 'DEBIT', type: 'LUXURY_TAX', settlementCategory: 'LUXURY_TAX', amountMinor: 404, note: '', createdAt: at },
      { id: 'tax-credit', leagueId: 'league-1', leagueTeamId: 'team-1', seasonId: 'season-1', rosterTransactionId: null, direction: 'CREDIT', type: 'LUXURY_TAX', settlementCategory: 'LUXURY_TAX', amountMinor: 4, note: '', createdAt: at },
      { id: 'legacy', leagueId: 'league-1', leagueTeamId: 'team-1', seasonId: 'season-1', rosterTransactionId: null, direction: 'DEBIT', type: 'LUXURY_TAX', amountMinor: 999, note: '', createdAt: at }
    ] as never);
    const result = await service.getSeasonSummary('user-1', 'team-1', 'season-1');
    expect(result.settlementItems).toHaveLength(9);
    expect(result.settlementItems.find(({ category }) => category === 'LUXURY_TAX')).toMatchObject({ amountMinor: 400 });
    expect(result.settlementTotalMinor).toBe(400);
  });

  it('rejects unauthorized owners and administrators', async () => {
    const { service, prisma, authorization, team } = harness();
    prisma.leagueTeam.findUnique.mockResolvedValueOnce({ ...team, ownerUserId: 'another-user' });
    await expect(service.getSeasonSummary('user-1', 'team-1', 'season-1'))
      .rejects.toMatchObject({ code: 'TEAM_FINANCE_OWNER_REQUIRED' });
    authorization.requireLeagueManager.mockRejectedValueOnce({ code: 'ADMIN_LEAGUE_ACCESS_DENIED' });
    await expect(service.createManualEntry('other-admin', 'league-1', {
      leagueTeamId: 'team-1', seasonId: null, direction: 'CREDIT', type: 'MANUAL_ADJUSTMENT',
      amountMinor: 1, note: '', reason: '测试权限'
    }, 'denied')).rejects.toMatchObject({ code: 'ADMIN_LEAGUE_ACCESS_DENIED' });
  });
});
