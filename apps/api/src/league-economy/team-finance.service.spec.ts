import { jest } from '@jest/globals';
import { TeamFinanceService } from './team-finance.service.js';

const at = new Date('2026-10-02T12:00:00.000Z');

function harness() {
  const team = { id: 'team-1', leagueId: 'league-1', ownerUserId: 'user-1', league: { currentSeasonId: 'season-1' as string | null } };
  const season = { id: 'season-1', leagueId: 'league-1' };
  const entries = [
    { id: 'credit-1', leagueId: 'league-1', leagueTeamId: 'team-1', seasonId: 'season-1', rosterTransactionId: null, direction: 'CREDIT', type: 'AUCTION', amountMinor: 2000, note: '拍卖收入', createdAt: at },
    { id: 'debit-1', leagueId: 'league-1', leagueTeamId: 'team-1', seasonId: 'season-1', rosterTransactionId: null, direction: 'DEBIT', type: 'LUXURY_TAX', amountMinor: 600, note: '奢侈税', createdAt: at }
  ];
  const tx = {
    leagueTeam: { findFirst: jest.fn(async () => team) },
    leagueSeason: { findFirst: jest.fn(async () => season) },
    financeLedgerEntry: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'entry-new', createdAt: at, ...data })) }
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
  return {
    service: new TeamFinanceService(prisma as never, authorization as never, receipts as never, audit as never),
    prisma, tx, authorization, receipts, audit, team
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
