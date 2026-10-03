import { jest } from '@jest/globals';
import { ValuationWindowsService } from './valuation-windows.service.js';

const at = new Date('2026-10-02T12:00:00.000Z');
const startsAt = new Date('2026-10-02T00:00:00.000Z');
const endsAt = new Date('2026-10-08T00:00:00.000Z');

function harness() {
  const season = { id: 'season-1', leagueId: 'league-1' };
  const rule = {
    id: 'rule-1', windowId: 'window-1', version: 1,
    minimumValueMinor: 100, maximumValueMinor: 10_000,
    maximumIncreaseBps: 2000, maximumDecreaseBps: 1500,
    createdByAdminId: 'admin-1', createdAt: at
  };
  const window = {
    id: 'window-1', seasonId: season.id, name: '季前申报', startsAt, endsAt,
    closedAt: null as Date | null, currentRuleVersionId: rule.id, createdByAdminId: 'admin-1',
    version: 1, createdAt: at, updatedAt: at, season, currentRuleVersion: rule
  };
  const tx = {
    $queryRaw: jest.fn(async () => [{ id: window.id }]),
    valuationWindow: {
      create: jest.fn(async () => ({ ...window, currentRuleVersionId: null })),
      update: jest.fn(async () => window),
      findUniqueOrThrow: jest.fn(async () => window)
    },
    valuationWindowRuleVersion: { create: jest.fn(async () => rule) },
    seasonEntry: { findMany: jest.fn(async () => [{ leagueTeamId: 'team-1' }]) },
    leaguePlayerOwnership: { findMany: jest.fn(async () => [{ id: 'ownership-1', leagueTeamId: 'team-1', footballPlayerId: 'player-1' }]) },
    leaguePlayerValuation: { findMany: jest.fn(async () => [{ footballPlayerId: 'player-1', currentValueMinor: 1200 }]) },
    valuationRosterSnapshot: { createMany: jest.fn(async () => ({ count: 1 })) }
  };
  const prisma = {
    leagueSeason: { findUniqueOrThrow: jest.fn(async () => season) },
    valuationWindow: {
      findUniqueOrThrow: jest.fn(async () => window),
      findMany: jest.fn(async () => [window])
    }
  };
  const authorization = { requireLeagueManager: jest.fn(async () => undefined) };
  const audit = { record: jest.fn(async () => undefined) };
  const receipts = {
    execute: jest.fn(async (
      _adminId: string,
      _operation: string,
      _key: string,
      work: (client: typeof tx) => Promise<unknown>
    ) => work(tx))
  };
  const service = new ValuationWindowsService(
    prisma as never,
    authorization as never,
    audit as never,
    receipts as never
  );
  return { service, prisma, tx, authorization, audit, receipts, season, window, rule };
}

describe('ValuationWindowsService', () => {
  it('creates independently named windows with an immutable first rule version', async () => {
    const { service, tx, authorization, audit } = harness();
    const result = await service.create('admin-1', 'season-1', {
      name: '季前申报',
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      rule: {
        minimumValueMinor: 100,
        maximumValueMinor: 10_000,
        maximumIncreaseBps: 2000,
        maximumDecreaseBps: 1500
      }
    }, 'create-window-1', at);

    expect(authorization.requireLeagueManager).toHaveBeenCalledWith('admin-1', 'league-1');
    expect(tx.valuationWindowRuleVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ windowId: 'window-1', version: 1 })
    });
    expect(tx.valuationRosterSnapshot.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ ownershipId: 'ownership-1', baseValueMinor: 1200 })],
      skipDuplicates: true
    });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'VALUATION_WINDOW_CREATED'
    }));
    expect(result).toMatchObject({ state: 'OPEN', currentRule: { version: 1 } });
  });

  it('rejects an inverted global range and percentages outside basis-point bounds', async () => {
    const { service } = harness();
    await expect(service.create('admin-1', 'season-1', {
      name: '错误窗口', startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
      rule: { minimumValueMinor: 500, maximumValueMinor: 100, maximumIncreaseBps: 100, maximumDecreaseBps: 100 }
    }, 'bad-window', at)).rejects.toBeDefined();
    await expect(service.create('admin-1', 'season-1', {
      name: '错误比例', startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
      rule: { minimumValueMinor: 100, maximumValueMinor: 500, maximumIncreaseBps: 10_001, maximumDecreaseBps: 100 }
    }, 'bad-bps', at)).rejects.toBeDefined();
  });

  it('updates the active rule by creating version 2 without mutating submissions on version 1', async () => {
    const { service, tx, window } = harness();
    const nextRule = {
      ...window.currentRuleVersion,
      id: 'rule-2', version: 2, maximumIncreaseBps: 2500
    };
    tx.valuationWindowRuleVersion.create.mockResolvedValueOnce(nextRule);
    tx.valuationWindow.update.mockResolvedValueOnce({
      ...window,
      currentRuleVersionId: nextRule.id,
      currentRuleVersion: nextRule,
      version: 2
    });

    const result = await service.update('admin-1', 'window-1', {
      expectedVersion: 1,
      rule: {
        minimumValueMinor: 100,
        maximumValueMinor: 10_000,
        maximumIncreaseBps: 2500,
        maximumDecreaseBps: 1500
      }
    }, 'update-window-1', at);

    expect(tx.valuationWindowRuleVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ version: 2, maximumIncreaseBps: 2500 })
    });
    expect(tx).not.toHaveProperty('valuationSubmission.updateMany');
    expect(result.currentRule).toMatchObject({ id: 'rule-2', version: 2 });
  });

  it('rejects optimistic conflicts and never reopens an explicitly closed window', async () => {
    const { service, tx, window, prisma } = harness();
    tx.valuationWindow.findUniqueOrThrow.mockResolvedValueOnce({ ...window, version: 3 });
    await expect(service.update('admin-1', 'window-1', {
      expectedVersion: 1,
      name: '冲突修改'
    }, 'conflict-1', at)).rejects.toMatchObject({ code: 'VALUATION_WINDOW_VERSION_CONFLICT' });

    prisma.valuationWindow.findUniqueOrThrow.mockResolvedValueOnce({ ...window, closedAt: at });
    tx.valuationWindow.findUniqueOrThrow.mockResolvedValueOnce({ ...window, closedAt: at });
    await expect(service.update('admin-1', 'window-1', {
      expectedVersion: 1,
      endsAt: new Date('2026-10-10T00:00:00.000Z').toISOString()
    }, 'reopen-1', at)).rejects.toMatchObject({ code: 'VALUATION_WINDOW_CLOSED' });
  });

  it('derives scheduled, open, and closed states from server time', async () => {
    const { service, prisma, window } = harness();
    prisma.valuationWindow.findMany.mockResolvedValueOnce([
      { ...window, id: 'scheduled', startsAt: new Date('2026-10-03T00:00:00.000Z') },
      window,
      { ...window, id: 'closed', endsAt: new Date('2026-10-02T01:00:00.000Z') }
    ]);
    const result = await service.listForSeason('admin-1', 'season-1', at);
    expect(result.items.map((item) => item.state)).toEqual(['SCHEDULED', 'OPEN', 'CLOSED']);
  });
});
