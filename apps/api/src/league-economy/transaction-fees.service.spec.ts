import { jest } from '@jest/globals';
import { TransactionFeesService } from './transaction-fees.service.js';

const at = new Date('2026-10-02T12:00:00.000Z');

function harness() {
  const rule = {
    id: 'rule-1', leagueId: 'league-1', version: 1, rateBps: 250,
    minimumFeeMinor: 300, effectiveAt: at, createdByAdminId: 'admin-1', createdAt: at
  };
  const tx = {
    $queryRaw: jest.fn(async () => [{ id: 'league-1' }]),
    league: { findUnique: jest.fn(async () => ({ id: 'league-1' })) },
    leagueTransactionFeeRuleVersion: {
      findFirst: jest.fn(async () => rule),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...rule, ...data }))
    },
    leaguePlayerValuation: {
      findUnique: jest.fn<() => Promise<{ currentValueMinor: number } | null>>(async () => ({ currentValueMinor: 20_000 }))
    }
  };
  const prisma = {
    leagueTransactionFeeRuleVersion: tx.leagueTransactionFeeRuleVersion,
    leaguePlayerValuation: tx.leaguePlayerValuation,
    rosterTransaction: { findMany: jest.fn(async () => []) },
    seasonEntry: { findFirst: jest.fn<() => Promise<{ id: string } | null>>(async () => ({ id: 'entry-1' })) }
  };
  const authorization = { requireLeagueManager: jest.fn(async () => undefined) };
  const receipts = {
    execute: jest.fn(async (_admin: string, _operation: string, _key: string, work: (client: typeof tx) => Promise<unknown>) => work(tx))
  };
  const audit = { record: jest.fn(async () => undefined) };
  const service = new TransactionFeesService(
    prisma as never, authorization as never, receipts as never, audit as never
  );
  return { service, prisma, tx, authorization, receipts, audit, rule };
}

describe('TransactionFeesService', () => {
  it('uses the greater of rounded-up valuation rate and minimum fee', async () => {
    const { service, tx } = harness();
    await expect(service.quote('league-1', 'player-1', at)).resolves.toMatchObject({
      valuationSnapshotMinor: 20_000, transactionFeeMinor: 500, transactionFeeRuleVersionId: 'rule-1'
    });
    tx.leaguePlayerValuation.findUnique.mockResolvedValueOnce({ currentValueMinor: 1000 });
    await expect(service.quote('league-1', 'player-1', at)).resolves.toMatchObject({
      transactionFeeMinor: 300
    });
  });

  it('blocks an automatic fee when the player has no official valuation', async () => {
    const { service, tx } = harness();
    tx.leaguePlayerValuation.findUnique.mockResolvedValueOnce(null);
    await expect(service.quote('league-1', 'player-1', at))
      .rejects.toMatchObject({ code: 'PLAYER_VALUATION_REQUIRED_FOR_FEE' });
  });

  it('creates an immutable next rule version with permission, locking and audit', async () => {
    const { service, authorization, tx, audit } = harness();
    const result = await service.createRuleVersion('admin-1', 'league-1', {
      rateBps: 300, minimumFeeMinor: 200, effectiveAt: at.toISOString(), expectedCurrentVersion: 1
    }, 'fee-rule-key');
    expect(result).toMatchObject({ version: 2, rateBps: 300, minimumFeeMinor: 200 });
    expect(authorization.requireLeagueManager).toHaveBeenCalledWith('admin-1', 'league-1');
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'TRANSACTION_FEE_RULE_CREATED' }));
  });

  it('exposes transaction records only to an approved league participant', async () => {
    const { service, prisma } = harness();
    await expect(service.listTransactionsForParticipant('user-1', 'league-1'))
      .resolves.toEqual({ items: [], nextCursor: null });
    prisma.seasonEntry.findFirst.mockResolvedValueOnce(null);
    await expect(service.listTransactionsForParticipant('outsider', 'league-1'))
      .rejects.toMatchObject({ code: 'LEAGUE_PARTICIPANT_REQUIRED' });
  });
});
