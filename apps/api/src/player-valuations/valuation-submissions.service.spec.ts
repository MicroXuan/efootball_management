import { jest } from '@jest/globals';
import { ValuationSubmissionsService } from './valuation-submissions.service.js';

const at = new Date('2026-10-04T12:00:00.000Z');
const windowId = '11111111-1111-4111-8111-111111111111';
const snapshotId = '22222222-2222-4222-8222-222222222222';

function harness(proposedValueMinor = 1100) {
  const rule = {
    id: 'rule-1', version: 1, minimumValueMinor: 100, maximumValueMinor: 10_000,
    maximumIncreaseBps: 2000, maximumDecreaseBps: 2000
  };
  const effective = {
    leagueId: 'league-1', rule,
    window: {
      id: windowId, seasonId: 'season-1', name: '季前申报', state: 'OPEN' as 'OPEN' | 'SCHEDULED' | 'CLOSED',
      startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-10-08T00:00:00.000Z',
      closedAt: null, currentRule: { ...rule, windowId, createdByAdminId: 'admin-1', createdAt: at.toISOString() },
      createdByAdminId: 'admin-1', version: 1, createdAt: at.toISOString(), updatedAt: at.toISOString()
    }
  };
  const snapshot = {
    id: snapshotId, windowId, leagueTeamId: 'team-1', ownershipId: 'ownership-1',
    footballPlayerId: 'player-1', baseValueMinor: 1000, createdAt: at,
    ownership: { status: 'ACTIVE', footballPlayer: {}, currentPlayerCard: {} }
  };
  const item = {
    id: 'item-1', submissionId: 'submission-1', snapshotId: snapshot.id,
    baseValueMinor: 1000, proposedValueMinor, minimumAllowedMinor: 800,
    maximumAllowedMinor: 1200, exceedsRange: proposedValueMinor > 1200,
    createdAt: at, updatedAt: at, snapshot
  };
  const submission = {
    id: 'submission-1', windowId, leagueTeamId: 'team-1', ruleVersionId: 'rule-1',
    attemptNumber: 1, status: 'DRAFT', submittedByUserId: 'user-1', submittedAt: null,
    reviewedByAdminId: null, reviewedAt: null, reviewReason: null, version: 1,
    createdAt: at, updatedAt: at, items: [item]
  };
  const tx = {
    $queryRaw: jest.fn(async () => [{ id: submission.id }]),
    valuationSubmission: {
      findFirst: jest.fn(async () => submission),
      findUniqueOrThrow: jest.fn(async () => submission),
      create: jest.fn(async () => ({ ...submission, id: 'submission-2', attemptNumber: 2 })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...submission, ...data, version: 2 }))
    },
    valuationSubmissionItem: {
      update: jest.fn(async () => item),
      upsert: jest.fn(async () => item)
    },
    leaguePlayerValuation: { upsert: jest.fn(async () => undefined) },
    playerValuationHistory: { create: jest.fn(async () => undefined) }
  };
  const prisma = {
    $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    leagueTeam: { findUnique: jest.fn(async () => ({ id: 'team-1', ownerUserId: 'user-1', leagueId: 'league-1' })) },
    seasonEntry: { findFirst: jest.fn(async () => ({ id: 'entry-1' })) },
    valuationSubmission: { findUniqueOrThrow: jest.fn(async () => ({ ...submission, window: { season: { leagueId: 'league-1' } } })) }
  };
  const windows = { getEffectiveRule: jest.fn(async () => effective) };
  const snapshots = { ensureWindowSnapshot: jest.fn(async () => [snapshot]) };
  const authorization = { requireLeagueManager: jest.fn(async () => undefined) };
  const userReceipts = { execute: jest.fn(async (_a: string, _o: string, _k: string, work: (client: typeof tx) => Promise<unknown>) => work(tx)) };
  const adminReceipts = { execute: jest.fn(async (_a: string, _o: string, _k: string, work: (client: typeof tx) => Promise<unknown>) => work(tx)) };
  const audit = { record: jest.fn(async () => undefined) };
  const service = new ValuationSubmissionsService(
    prisma as never, windows as never, snapshots as never, authorization as never,
    userReceipts as never, adminReceipts as never, audit as never
  );
  return { service, prisma, tx, windows, snapshots, authorization, userReceipts, adminReceipts, audit, effective, snapshot, item, submission };
}

describe('ValuationSubmissionsService', () => {
  it('publishes a compliant batch immediately and writes one immutable history', async () => {
    const { service, tx, audit } = harness(1100);
    const result = await service.publish('user-1', 'team-1', {
      windowId, expectedVersion: 1
    }, 'publish-1', at);
    expect(result.status).toBe('PUBLISHED');
    expect(tx.leaguePlayerValuation.upsert).toHaveBeenCalledTimes(1);
    expect(tx.playerValuationHistory.create).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('holds the entire batch when any existing valuation exceeds its range', async () => {
    const { service, tx } = harness(1500);
    const result = await service.publish('user-1', 'team-1', {
      windowId, expectedVersion: 1
    }, 'publish-2', at);
    expect(result.status).toBe('PENDING_REVIEW');
    expect(tx.leaguePlayerValuation.upsert).not.toHaveBeenCalled();
    expect(tx.playerValuationHistory.create).not.toHaveBeenCalled();
  });

  it('allows an unchanged official value to carry forward after the global minimum rises', async () => {
    const { service, tx, effective } = harness(1000);
    effective.rule.minimumValueMinor = 1200;
    const result = await service.publish('user-1', 'team-1', {
      windowId, expectedVersion: 1
    }, 'publish-unchanged', at);
    expect(result.status).toBe('PUBLISHED');
    expect(tx.playerValuationHistory.create).not.toHaveBeenCalled();
  });

  it('rechecks the locked batch so concurrent publishes cannot create duplicate history', async () => {
    const { service, tx, submission } = harness(1100);
    tx.valuationSubmission.findUniqueOrThrow.mockResolvedValueOnce({
      ...submission,
      status: 'PUBLISHED'
    });
    await expect(service.publish('user-1', 'team-1', {
      windowId, expectedVersion: 1
    }, 'publish-concurrent', at)).rejects.toMatchObject({
      code: 'VALUATION_SUBMISSION_ALREADY_PUBLISHED'
    });
    expect(tx.playerValuationHistory.create).not.toHaveBeenCalled();
  });

  it('requires every first valuation before publishing', async () => {
    const { service, tx, snapshot, submission } = harness();
    snapshot.baseValueMinor = null as never;
    tx.valuationSubmission.findFirst.mockResolvedValueOnce({ ...submission, items: [] } as never);
    tx.valuationSubmission.findUniqueOrThrow.mockResolvedValueOnce({ ...submission, items: [] } as never);
    await expect(service.publish('user-1', 'team-1', {
      windowId, expectedVersion: 1
    }, 'publish-3', at)).rejects.toMatchObject({ code: 'VALUATION_FIRST_VALUE_REQUIRED' });
  });

  it('rejects a first valuation outside the global minimum and maximum', async () => {
    const { service, tx, snapshot, submission, item } = harness(50);
    snapshot.baseValueMinor = null as never;
    const firstItem = { ...item, baseValueMinor: null, proposedValueMinor: 50 };
    tx.valuationSubmission.findFirst.mockResolvedValueOnce({ ...submission, items: [firstItem] } as never);
    tx.valuationSubmission.findUniqueOrThrow.mockResolvedValueOnce({ ...submission, items: [firstItem] } as never);
    await expect(service.publish('user-1', 'team-1', {
      windowId, expectedVersion: 1
    }, 'publish-first-outside', at)).rejects.toMatchObject({
      code: 'VALUATION_FIRST_VALUE_OUT_OF_RANGE'
    });
  });

  it('blocks a new publish after close but allows an administrator to approve a pending batch', async () => {
    const blocked = harness(1100);
    blocked.windows.getEffectiveRule.mockResolvedValueOnce({
      ...blocked.effective,
      window: { ...blocked.effective.window, state: 'CLOSED' }
    });
    await expect(blocked.service.publish('user-1', 'team-1', {
      windowId, expectedVersion: 1
    }, 'publish-closed', at)).rejects.toMatchObject({ code: 'VALUATION_WINDOW_NOT_OPEN' });

    const review = harness(1500);
    review.tx.valuationSubmission.findUniqueOrThrow.mockResolvedValueOnce({
      ...review.submission, status: 'PENDING_REVIEW', items: [review.item]
    });
    const result = await review.service.approve('admin-1', 'submission-1', {
      expectedVersion: 1, reason: '已核对特殊调整'
    }, 'approve-1', at);
    expect(result.status).toBe('APPROVED');
    expect(review.tx.leaguePlayerValuation.upsert).toHaveBeenCalledTimes(1);
  });

  it('requires a reason for reject and permits a new draft attempt after rejection', async () => {
    const { service, tx, submission } = harness();
    await expect(service.reject('admin-1', 'submission-1', {
      expectedVersion: 1, reason: ' '
    }, 'reject-1', at)).rejects.toBeDefined();
    tx.valuationSubmission.findFirst.mockResolvedValueOnce({ ...submission, status: 'REJECTED' });
    await service.saveDraft('user-1', 'team-1', {
      windowId, expectedVersion: 1,
      items: [{ snapshotId, proposedValueMinor: 1150 }]
    }, at);
    expect(tx.valuationSubmission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ attemptNumber: 2 })
    });
  });
});
