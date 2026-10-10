/* eslint-disable @typescript-eslint/no-explicit-any -- focused aggregate test doubles */
import { jest } from '@jest/globals';
import { AdminPlayerAuctionsService } from './admin-player-auctions.service.js';

const now = new Date('2026-10-09T12:00:00.000Z');

function harness() {
  const batch: any = {
    id: 'batch-1', leagueId: 'league-1', groupBindingId: 'group-1', name: '秋季拍卖',
    status: 'DRAFT', currentLotId: null, version: 1, startedAt: null, completedAt: null,
    cancelledAt: null, createdAt: now, updatedAt: now, groupBinding: { displayName: 'CELL 联赛群' },
    lots: []
  };
  const tx: any = {
    $queryRaw: jest.fn(async () => []),
    wechatGroupBinding: { findFirst: jest.fn(async () => ({
      id: 'group-1', leagueId: 'league-1', enabled: true, version: 1,
      capabilities: [{ capability: 'PLAYER_AUCTION' }]
    })) },
    playerAuctionBatch: {
      findFirst: jest.fn(async () => batch), findMany: jest.fn(async () => [batch]),
      create: jest.fn(async ({ data }: any) => Object.assign(batch, data)),
      updateMany: jest.fn(async ({ data }: any) => { Object.assign(batch, data, { version: batch.version + 1 }); return { count: 1 }; })
    },
    playerAuctionLot: {
      deleteMany: jest.fn(async () => ({ count: batch.lots.length })),
      createMany: jest.fn(async ({ data }: any) => { batch.lots = data.map((lot: any, index: number) => ({ id: `lot-${index + 1}`, ...lot, bids: [], review: null, version: 1, status: 'QUEUED', currentPrice: null, currentHighestBidId: null, deadlineAt: null, deadlineEpoch: 0, pausedRemainingMs: null, startedAt: null, closedAt: null, reviewedAt: null })); return { count: data.length }; }),
      findFirst: jest.fn(async () => batch.lots[0] ?? null),
      updateMany: jest.fn(async () => ({ count: 1 }))
    },
    footballPlayer: { findMany: jest.fn(async () => [{ id: 'player-1', nameZh: '车范根', nameEn: 'Cha Bum-Kun', shortName: null, nationality: '韩国', club: null }]) },
    playerCard: { findMany: jest.fn(async () => [{ id: 'card-1', playerId: 'player-1', cardName: '传奇', position: 'CF', overallRating: 96, cardType: 'EPIC', status: 'ACTIVE' }]) },
    leagueTeam: { findFirst: jest.fn(async () => ({ id: 'team-1', leagueId: 'league-1', name: '申花' })) },
    playerAuctionReview: { create: jest.fn(async ({ data }: any) => ({ id: 'review-1', reviewedAt: now, ...data })) }
  };
  const receipts: any = { execute: jest.fn(async (_a: string, _o: string, _k: string, work: any) => work(tx)) };
  const authorization: any = { requireLeagueAccess: jest.fn(async () => undefined) };
  const audit: any = { record: jest.fn(async () => undefined) };
  const service = new AdminPlayerAuctionsService({} as never, authorization, receipts, audit);
  return { service, tx, batch, audit };
}

describe('AdminPlayerAuctionsService', () => {
  it('enforces league-scoped enabled group bindings when creating a draft', async () => {
    const { service, tx } = harness();
    tx.wechatGroupBinding.findFirst.mockResolvedValueOnce(null);
    await expect(service.create('admin-1', 'league-1', {
      groupBindingId: 'other-group', name: '拍卖', expectedVersion: 0
    }, 'create-1')).rejects.toMatchObject({ code: 'AUCTION_GROUP_INVALID' });
  });

  it('rejects an enabled query-only group when creating a draft', async () => {
    const { service, tx } = harness();
    const queryOnlyGroup = {
      id: 'group-1', leagueId: 'league-1', enabled: true, version: 1,
      capabilities: [{ capability: 'SCHEDULE_QUERY' }]
    };
    tx.wechatGroupBinding.findFirst.mockImplementationOnce(async ({ where }: any) =>
      queryOnlyGroup.capabilities.some((item) => item.capability === where.capabilities.some.capability)
        ? queryOnlyGroup
        : null
    );

    await expect(service.create('admin-1', 'league-1', {
      groupBindingId: 'group-1', name: '拍卖', expectedVersion: 1
    }, 'create-query-only')).rejects.toMatchObject({ code: 'AUCTION_GROUP_INVALID' });
    expect(tx.wechatGroupBinding.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'group-1',
        leagueId: 'league-1',
        enabled: true,
        capabilities: { some: { capability: 'PLAYER_AUCTION' } }
      }
    });
  });

  it('replaces draft lots with validated player/card snapshots in contiguous order', async () => {
    const { service, tx, batch } = harness();
    await service.replaceLots('admin-1', 'league-1', 'batch-1', {
      expectedVersion: 1,
      lots: [{ playerId: 'player-1', playerCardId: 'card-1', displayOrder: 1, startingPrice: 50, minimumIncrement: 10 }]
    }, 'lots-1');
    expect(tx.playerAuctionLot.createMany).toHaveBeenCalled();
    expect(batch.lots[0]).toMatchObject({ playerNameSnapshot: '车范根', startingPrice: 50, minimumIncrement: 10 });
  });

  it('rejects edits outside draft state and optimistic version conflicts', async () => {
    const { service, batch, tx } = harness();
    batch.status = 'READY';
    await expect(service.update('admin-1', 'league-1', 'batch-1', {
      name: '新名字', expectedVersion: 1
    }, 'update-1')).rejects.toMatchObject({ code: 'AUCTION_DRAFT_REQUIRED' });
    batch.status = 'DRAFT';
    tx.playerAuctionBatch.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.update('admin-1', 'league-1', 'batch-1', {
      name: '新名字', expectedVersion: 1
    }, 'update-2')).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('prepares only a non-empty batch and rejects another unresolved batch for the group', async () => {
    const { service, tx, batch } = harness();
    await expect(service.prepare('admin-1', 'league-1', 'batch-1', { expectedVersion: 1 }, 'prepare-1'))
      .rejects.toMatchObject({ code: 'AUCTION_LOTS_REQUIRED' });
    batch.lots = [{ id: 'lot-1', bids: [], review: null }];
    tx.playerAuctionBatch.findFirst
      .mockResolvedValueOnce(batch)
      .mockResolvedValueOnce({ id: 'batch-other' });
    await expect(service.prepare('admin-1', 'league-1', 'batch-1', { expectedVersion: 1 }, 'prepare-2'))
      .rejects.toMatchObject({ code: 'AUCTION_GROUP_BUSY' });
  });

  it('revalidates auction capability before preparing a stale draft', async () => {
    const { service, tx, batch } = harness();
    batch.lots = [{ id: 'lot-1' }];
    tx.wechatGroupBinding.findFirst.mockResolvedValueOnce(null);

    await expect(service.prepare('admin-1', 'league-1', 'batch-1', { expectedVersion: 1 }, 'prepare-stale'))
      .rejects.toMatchObject({ code: 'AUCTION_GROUP_INVALID' });
    expect(tx.wechatGroupBinding.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'group-1',
        leagueId: 'league-1',
        enabled: true,
        capabilities: { some: { capability: 'PLAYER_AUCTION' } }
      },
      select: { id: true }
    });
  });

  it('does not let an unresolved batch in group A block an eligible group B', async () => {
    const { service, tx, batch } = harness();
    batch.groupBindingId = 'group-2';
    batch.lots = [{ id: 'lot-1', bids: [], review: null }];
    tx.wechatGroupBinding.findFirst.mockResolvedValueOnce({ id: 'group-2' });
    tx.playerAuctionBatch.findFirst
      .mockResolvedValueOnce(batch)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(batch);

    await expect(service.prepare('admin-1', 'league-1', 'batch-1', { expectedVersion: 1 }, 'prepare-group-b'))
      .resolves.toMatchObject({ id: 'batch-1' });
    expect(tx.playerAuctionBatch.findFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ groupBindingId: 'group-2' })
    }));
  });

  it('reviews pending results without mutating the immutable computed winner', async () => {
    const { service, tx, batch } = harness();
    batch.status = 'ACTIVE';
    batch.lots = [{
      id: 'lot-1', batchId: 'batch-1', status: 'PENDING_REVIEW', version: 3,
      currentPrice: 120, currentHighestBid: { leagueTeamId: 'team-1', leagueTeam: { name: '申花' } }
    }];
    const result = await service.reviewLot('admin-1', 'league-1', 'batch-1', 'lot-1', {
      decision: 'ADJUST', expectedVersion: 3, reviewedTeamId: 'team-1', reviewedPrice: 130, reason: '人工核对'
    }, 'review-1');
    expect(tx.playerAuctionReview.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      computedWinnerTeamId: 'team-1', computedPrice: 120, reviewedPrice: 130
    }) }));
    expect(result.review.computedPrice).toBe(120);
  });
});
