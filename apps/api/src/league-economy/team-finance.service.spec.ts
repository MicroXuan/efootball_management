import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { TeamFinanceService } from './team-finance.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';
import { RosterLockRepository } from '../league-rosters/roster-lock.repository.js';
import { synchronizeSeasonValuationSnapshots } from '../player-valuations/valuation-snapshot-coordinator.js';
import type { Prisma } from '../generated/prisma/client.js';

config({ path: '../../.env', quiet: true });

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
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(String((tx.$queryRaw.mock.calls as unknown[][])[0]![0])).toContain('league_seasons');
    expect(String((tx.$queryRaw.mock.calls as unknown[][])[1]![0])).toContain('league_teams');
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[1]!);
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(tx.financeLedgerEntry.findMany.mock.invocationCallOrder[0]!);
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

  it('does not deadlock against the real season-then-team roster lock order', async () => {
    const prisma = new PrismaService();
    const suffix = randomUUID();
    const adminId = randomUUID();
    const userId = randomUUID();
    let leagueId = '';
    let seasonId = '';
    let teamId = '';
    let catalogId = '';
    const gate = () => {
      let release!: () => void;
      const promise = new Promise<void>((resolve) => { release = resolve; });
      return { promise, release };
    };
    await prisma.$connect();
    try {
      await prisma.adminAccount.create({ data: { id: adminId, username: `finance-lock-${suffix}`, displayName: '财务锁测试', passwordHash: 'unused', platformRole: 'PLATFORM_ADMIN' } });
      await prisma.user.create({ data: { id: userId, wechatOpenId: `finance-lock-${suffix}`, displayName: '财务锁用户' } });
      const league = await prisma.league.create({ data: { name: '财务锁联赛', shortName: '锁联赛', defaultPlatform: 'MOBILE', defaultServerRegion: 'GLOBAL', createdByAdminId: adminId } });
      leagueId = league.id;
      const season = await prisma.leagueSeason.create({ data: { leagueId, seasonNumber: 1, displayName: 'S1', isFirstSeason: true,
        registrationOpensAt: new Date('2026-01-01'), registrationClosesAt: new Date('2026-01-02'),
        startsAt: new Date('2026-01-03'), endsAt: new Date('2027-01-01'), superCapacity: 2,
        championCapacity: 2, promotionCount: 1, status: 'IN_PROGRESS', createdByAdminId: adminId } });
      seasonId = season.id;
      const catalog = await prisma.teamCatalogItem.create({ data: { sourceType: 'CUSTOM', nameZh: '锁测试队', shortName: '锁队' } });
      catalogId = catalog.id;
      const team = await prisma.leagueTeam.create({ data: { leagueId, ownerUserId: userId, ownerAlias: '锁用户', catalogTeamId: catalogId,
        teamNumber: 1, name: '锁测试队', shortName: '锁队' } });
      teamId = team.id;

      const settlementReachedFirstLock = gate();
      let settlementLockCount = 0;
      const observedPrisma = new Proxy(prisma, { get(target, key) {
        if (key !== '$transaction') return Reflect.get(target, key, target);
        return <T>(work: (tx: Prisma.TransactionClient) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }) =>
          target.$transaction((tx) => work(new Proxy(tx, { get(transaction, transactionKey) {
            const value = Reflect.get(transaction, transactionKey, transaction);
            if (transactionKey !== '$queryRaw') return value;
            return async (...args: unknown[]) => {
              const isFirst = settlementLockCount++ === 0;
              const sql = String(args[0]);
              if (isFirst && sql.includes('league_seasons')) settlementReachedFirstLock.release();
              const result = await Reflect.apply(value as (...values: unknown[]) => Promise<unknown>, transaction, args);
              if (isFirst && sql.includes('league_teams')) settlementReachedFirstLock.release();
              return result;
            };
          } })), options);
      } }) as PrismaService;
      const service = new TeamFinanceService(observedPrisma, new AdminAuthorizationService(observedPrisma),
        new AdminMutationReceiptService(observedPrisma), new AuditLogService(observedPrisma),
        new LeagueVisibilityService(observedPrisma));
      const rosterHasSeasonLock = gate();
      const roster = prisma.$transaction(async (tx) => {
        await synchronizeSeasonValuationSnapshots(tx, seasonId);
        rosterHasSeasonLock.release();
        await settlementReachedFirstLock.promise;
        await new RosterLockRepository().lockTeam(tx, teamId);
      }, { isolationLevel: 'ReadCommitted' });
      await rosterHasSeasonLock.promise;
      const settlement = service.upsertSettlement(adminId, leagueId, {
        leagueTeamId: teamId, seasonId,
        amounts: { transactionAmountMinor: 0, luxuryTaxMinor: 500, offseasonFeeMinor: 0,
          unfinishedMatchPenaltyMinor: 0, playerAuctionMinor: 0, teamAuctionMinor: 0,
          rookieSelectionMinor: 0, installmentPaymentMinor: 0, otherAdjustmentMinor: 0 },
        note: '锁顺序测试', reason: '验证结算与阵容并发'
      }, `lock-${suffix}`);

      const outcomes = await Promise.allSettled([roster, settlement]);
      expect(outcomes).toEqual([
        expect.objectContaining({ status: 'fulfilled' }),
        expect.objectContaining({ status: 'fulfilled' })
      ]);
      await expect(prisma.financeLedgerEntry.count({ where: { leagueTeamId: teamId, seasonId,
        settlementCategory: 'LUXURY_TAX' } })).resolves.toBe(1);
    } finally {
      if (leagueId) {
        await prisma.auditLog.deleteMany({ where: { leagueId } });
        await prisma.adminMutationReceipt.deleteMany({ where: { adminId } });
        await prisma.financeLedgerEntry.deleteMany({ where: { leagueId } });
        await prisma.leagueTeam.deleteMany({ where: { leagueId } });
        await prisma.leagueSeason.deleteMany({ where: { leagueId } });
        await prisma.league.deleteMany({ where: { id: leagueId } });
      }
      if (catalogId) await prisma.teamCatalogItem.deleteMany({ where: { id: catalogId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.adminAccount.deleteMany({ where: { id: adminId } });
      await prisma.$disconnect();
    }
  }, 15_000);
});
