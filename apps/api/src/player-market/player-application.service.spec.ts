import { jest } from '@jest/globals';
import { PlayerApplicationService } from './player-application.service.js';

const now = new Date('2026-10-14T12:00:00.000Z');
const baseInput = {
  seasonId: 'season-1', transferWindowId: 'window-1', footballPlayerId: 'player-1',
  playerCardId: 'card-1', type: 'NORMAL_PURCHASE' as const, amountMinor: 500
};

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: 'application-1', leagueId: 'league-1', seasonId: 'season-1', transferWindowId: 'window-1',
    type: 'NORMAL_PURCHASE', applicantLeagueTeamId: 'team-1', footballPlayerId: 'player-1', playerCardId: 'card-1',
    sourceLeagueTeamId: null, ownershipId: null, ownershipVersionSnapshot: null, amountMinor: 500,
    valuationMinorSnapshot: 500, valuationVersionSnapshot: 1, status: 'PENDING',
    firstValidSubmittedAt: now, lastSubmittedAt: now, reviewedAt: null, reviewReason: null, version: 1,
    createdAt: now, updatedAt: now,
    applicantLeagueTeam: { id: 'team-1', teamNumber: 1, name: '我的队', logoUrl: null, ownerAlias: '我' },
    sourceLeagueTeam: null,
    footballPlayer: { nameZh: '测试球员', nameEn: null, shortName: null },
    playerCard: { id: 'card-1', cardName: '精选', imageUrl: null, position: 'CF', overallRating: 90, autoBuilds: [{ maxOverall: 95 }] },
    events: [],
    ...overrides
  };
}

function harness() {
  let stored = application();
  let existing: ReturnType<typeof application> | null = null;
  const tx = {
    $queryRaw: jest.fn(async () => []),
    leagueTeam: { findUnique: jest.fn(async () => ({ id: 'team-1', status: 'ACTIVE', rosterStatus: 'COMPLIANT' })) },
    transferWindow: { findUnique: jest.fn(async () => ({ id: 'window-1', seasonId: 'season-1', allowBuy: true, startsAt: new Date(now.getTime() - 1000), endsAt: new Date(now.getTime() + 1000) })) },
    forcedOfferWindow: { findUnique: jest.fn(async () => ({ id: 'forced-1', seasonId: 'season-1', startsAt: new Date(now.getTime() - 1000), endsAt: new Date(now.getTime() + 1000) })) },
    leaguePlayerOwnership: {
      findUnique: jest.fn(async () => null),
      count: jest.fn(async () => 24)
    },
    playerReleaseRestriction: { findUnique: jest.fn(async () => null) },
    playerCard: { findFirst: jest.fn(async () => ({ id: 'card-1', playerId: 'player-1', status: 'ACTIVE', overallRating: 90, autoBuilds: [{ maxOverall: 95 }] })) },
    leaguePlayerValuation: { findUnique: jest.fn(async () => ({ currentValueMinor: 500, version: 1 })) },
    playerAcquisitionApplication: {
      findFirst: jest.fn(async () => existing && ['PENDING', 'REQUOTE_REQUIRED'].includes(existing.status) ? existing : null),
      findMany: jest.fn(async () => [] as ReturnType<typeof application>[]),
      findUnique: jest.fn(async () => stored),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        stored = application({
          ...data,
          ...(data.sourceLeagueTeamId ? { sourceLeagueTeam: { id: 'team-2', teamNumber: 2, name: '对手队', logoUrl: null, ownerAlias: '对手' } } : {})
        });
        return stored;
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        stored = application({ ...stored, ...data, version: stored.version + 1, updatedAt: now });
        if (existing?.id === stored.id) existing = stored;
        return stored;
      })
    },
    playerAcquisitionApplicationEvent: { create: jest.fn(async () => ({ id: 'event-1' })) }
  };
  const prisma = { playerAcquisitionApplication: tx.playerAcquisitionApplication };
  const receipts = { execute: jest.fn(async (_actor: string, _operation: string, _key: string, work: (client: typeof tx) => Promise<unknown>) => work(tx)) };
  const access = {
    requireParticipant: jest.fn(async () => ({ leagueTeamId: 'team-1', rosterStatus: 'COMPLIANT' })),
    requireOwnedTeam: jest.fn(async () => ({ leagueTeamId: 'team-1', rosterStatus: 'COMPLIANT' }))
  };
  const locks = { lockSeason: jest.fn(async () => undefined), lockPlayer: jest.fn(async () => undefined),
    lockTeam: jest.fn(async () => undefined), lockTeams: jest.fn(async () => undefined),
    lockApplication: jest.fn(async () => undefined), lockApplicationsForPlayer: jest.fn(async () => undefined) };
  const service = new PlayerApplicationService(prisma as never, receipts as never, access as never, locks as never, () => now);
  return { service, tx, receipts, access, locks, setExisting: (value: ReturnType<typeof application> | null) => { existing = value; } };
}

describe('PlayerApplicationService', () => {
  it('creates a pending normal application and public event through the idempotency receipt', async () => {
    const { service, tx, receipts, locks } = harness();
    const result = await service.submit('user-1', 'league-1', baseInput, 'key-1');
    expect(result).toMatchObject({ status: 'PENDING', amountMinor: 500, version: 1 });
    expect(receipts.execute).toHaveBeenCalledWith('user-1', 'player-market.submit:league-1:player-1', 'key-1', expect.any(Function));
    expect(tx.playerAcquisitionApplicationEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'SUBMITTED', actorUserId: 'user-1' }) }));
    expect(locks.lockSeason.mock.invocationCallOrder[0]).toBeLessThan(locks.lockPlayer.mock.invocationCallOrder[0]!);
    expect(locks.lockPlayer.mock.invocationCallOrder[0]).toBeLessThan(locks.lockTeams.mock.invocationCallOrder[0]!);
    expect(locks.lockTeams.mock.invocationCallOrder[0]).toBeLessThan(locks.lockApplicationsForPlayer.mock.invocationCallOrder[0]!);
  });

  it('rejects a duplicate active attempt by the same team', async () => {
    const { service, setExisting } = harness();
    setExisting(application());
    await expect(service.submit('user-1', 'league-1', baseInput, 'key-2'))
      .rejects.toMatchObject({ code: 'ACTIVE_APPLICATION_EXISTS' });
  });

  it('does not let a pending application from closed W1 block a submission in open W2', async () => {
    const { service, tx, setExisting } = harness();
    const stale = application({ transferWindowId: 'window-closed' });
    setExisting(stale);
    tx.playerAcquisitionApplication.findMany.mockResolvedValueOnce([stale]);
    tx.transferWindow.findUnique.mockImplementation(async (args?: { where: { id: string } }) => args?.where.id === 'window-closed'
      ? { id: 'window-closed', seasonId: 'season-1', allowBuy: true, startsAt: new Date(now.getTime() - 2000), endsAt: new Date(now.getTime() - 1000) }
      : { id: 'window-1', seasonId: 'season-1', allowBuy: true, startsAt: new Date(now.getTime() - 1000), endsAt: new Date(now.getTime() + 1000) });

    const result = await service.submit('user-1', 'league-1', baseInput, 'window-2');

    expect(result).toMatchObject({ status: 'PENDING', transferWindowId: 'window-1' });
    expect(tx.playerAcquisitionApplication.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'EXPIRED', reviewReason: 'TRANSFER_WINDOW_CLOSED' })
    }));
  });

  it('rejects capacity, existing ownership, non-compliance, and the exact closing instant', async () => {
    const { service, tx } = harness();
    tx.leaguePlayerOwnership.count.mockResolvedValueOnce(25);
    await expect(service.submit('user-1', 'league-1', baseInput, 'capacity'))
      .rejects.toMatchObject({ code: 'ROSTER_CAPACITY_REACHED' });

    tx.leaguePlayerOwnership.findUnique.mockResolvedValueOnce({ id: 'owned', status: 'ACTIVE' } as never);
    await expect(service.submit('user-1', 'league-1', baseInput, 'owned'))
      .rejects.toMatchObject({ code: 'PLAYER_ALREADY_OWNED' });

    tx.leagueTeam.findUnique.mockResolvedValueOnce({ id: 'team-1', status: 'ACTIVE', rosterStatus: 'OVER_CAP' });
    await expect(service.submit('user-1', 'league-1', baseInput, 'cap'))
      .rejects.toMatchObject({ code: 'ROSTER_NON_COMPLIANT' });

    tx.transferWindow.findUnique.mockResolvedValueOnce({ id: 'window-1', seasonId: 'season-1', allowBuy: true, startsAt: new Date(now.getTime() - 1000), endsAt: now });
    await expect(service.submit('user-1', 'league-1', baseInput, 'closed'))
      .rejects.toMatchObject({ code: 'TRANSFER_WINDOW_CLOSED' });
  });

  it('amends without changing first submission time and withdraws to a terminal state', async () => {
    const { service, tx } = harness();
    const amended = await service.amend('user-1', 'application-1', { amountMinor: 700, expectedVersion: 1 }, 'amend');
    expect(amended).toMatchObject({ amountMinor: 700, firstValidSubmittedAt: now.toISOString(), version: 2 });
    expect(tx.playerAcquisitionApplicationEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'AMOUNT_CHANGED', fromAmountMinor: 500, toAmountMinor: 700 }) }));

    const withdrawn = await service.withdraw('user-1', 'application-1', { expectedVersion: 2, reason: '改变计划' }, 'withdraw');
    expect(withdrawn).toMatchObject({ status: 'WITHDRAWN', version: 3 });
  });

  it('does not let another team mutate an application', async () => {
    const { service, access } = harness();
    access.requireOwnedTeam.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { code: 'PLAYER_MARKET_TEAM_OWNER_REQUIRED' }));
    await expect(service.amend('other-user', 'application-1', { amountMinor: 700, expectedVersion: 1 }, 'other'))
      .rejects.toMatchObject({ code: 'PLAYER_MARKET_TEAM_OWNER_REQUIRED' });
  });

  it('submits a forced transfer against the current rival ownership and official value', async () => {
    const { service, tx } = harness();
    tx.leaguePlayerOwnership.findUnique.mockResolvedValueOnce({
      id: 'ownership-rival', leagueTeamId: 'team-2', currentPlayerCardId: 'card-2',
      status: 'ACTIVE', version: 4
    } as never);
    tx.playerCard.findFirst.mockResolvedValueOnce({
      id: 'card-2', playerId: 'player-1', status: 'ACTIVE', overallRating: 92, autoBuilds: [{ maxOverall: 98 }]
    });
    const result = await service.submit('user-1', 'league-1', {
      ...baseInput,
      type: 'FORCED_TRANSFER',
      transferWindowId: undefined,
      window: { kind: 'FORCED_OFFER', id: 'forced-1' },
      playerCardId: 'card-2',
      amountMinor: 700,
      sourceLeagueTeamId: 'team-2',
      ownershipId: 'ownership-rival',
      ownershipVersionSnapshot: 4
    }, 'forced');
    expect(result).toMatchObject({
      type: 'FORCED_TRANSFER', sourceTeam: expect.anything(), ownershipId: 'ownership-rival',
      ownershipVersionSnapshot: 4, valuationVersionSnapshot: 1, transferWindowId: null, forcedOfferWindowId: 'forced-1'
    });
  });

  it('rejects forced bids below official value', async () => {
    const { service, tx } = harness();
    tx.leaguePlayerOwnership.findUnique.mockResolvedValueOnce({
      id: 'ownership-rival', leagueTeamId: 'team-2', currentPlayerCardId: 'card-2', status: 'ACTIVE', version: 4
    } as never);
    await expect(service.submit('user-1', 'league-1', {
      ...baseInput, type: 'FORCED_TRANSFER', transferWindowId: undefined, window: { kind: 'FORCED_OFFER', id: 'forced-1' }, amountMinor: 499,
      sourceLeagueTeamId: 'team-2', ownershipId: 'ownership-rival', ownershipVersionSnapshot: 4
    }, 'forced-low')).rejects.toMatchObject({ code: 'FORCED_AMOUNT_BELOW_OFFICIAL_VALUE' });
  });

  it('accepts an owned-player bid while transfers are closed, but not after forced-offer close', async () => {
    const { service, tx } = harness();
    tx.transferWindow.findUnique.mockResolvedValue(null);
    tx.leaguePlayerOwnership.findUnique.mockResolvedValue({
      id: 'ownership-rival', leagueTeamId: 'team-2', currentPlayerCardId: 'card-2', status: 'ACTIVE', version: 4
    } as never);
    const input = {
      ...baseInput, transferWindowId: undefined, window: { kind: 'FORCED_OFFER' as const, id: 'forced-1' },
      type: 'FORCED_TRANSFER' as const, amountMinor: 700,
      sourceLeagueTeamId: 'team-2', ownershipId: 'ownership-rival', ownershipVersionSnapshot: 4
    };
    await expect(service.submit('user-1', 'league-1', input, 'forced-open'))
      .resolves.toMatchObject({ forcedOfferWindowId: 'forced-1', transferWindowId: null });
    expect(tx.transferWindow.findUnique).not.toHaveBeenCalled();
    tx.forcedOfferWindow.findUnique.mockResolvedValueOnce({ id: 'forced-1', seasonId: 'season-1', startsAt: new Date(now.getTime() - 1000), endsAt: now });
    await expect(service.submit('user-1', 'league-1', input, 'forced-closed'))
      .rejects.toMatchObject({ code: 'FORCED_OFFER_WINDOW_CLOSED' });
  });

  it('rejects a forced window from another season and blocks amendment after the deadline', async () => {
    const { service, tx } = harness();
    tx.leaguePlayerOwnership.findUnique.mockResolvedValue({
      id: 'ownership-rival', leagueTeamId: 'team-2', currentPlayerCardId: 'card-2', status: 'ACTIVE', version: 4
    } as never);
    const input = {
      ...baseInput, transferWindowId: undefined, window: { kind: 'FORCED_OFFER' as const, id: 'forced-1' },
      type: 'FORCED_TRANSFER' as const, amountMinor: 700,
      sourceLeagueTeamId: 'team-2', ownershipId: 'ownership-rival', ownershipVersionSnapshot: 4
    };
    tx.forcedOfferWindow.findUnique.mockResolvedValueOnce({ id: 'forced-1', seasonId: 'season-2', startsAt: new Date(now.getTime() - 1000), endsAt: new Date(now.getTime() + 1000) });
    await expect(service.submit('user-1', 'league-1', input, 'wrong-season'))
      .rejects.toMatchObject({ code: 'FORCED_OFFER_WINDOW_CLOSED' });
    await service.submit('user-1', 'league-1', input, 'valid');
    tx.forcedOfferWindow.findUnique.mockResolvedValueOnce({ id: 'forced-1', seasonId: 'season-1', startsAt: new Date(now.getTime() - 1000), endsAt: now });
    await expect(service.amend('user-1', 'application-1', { amountMinor: 800, expectedVersion: 1 }, 'late'))
      .rejects.toMatchObject({ code: 'FORCED_OFFER_WINDOW_CLOSED' });
  });
});
