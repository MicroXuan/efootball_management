/* eslint-disable @typescript-eslint/no-explicit-any -- focused Prisma transaction doubles */
import { jest } from '@jest/globals';
import { AdminPlayerAuctionsService } from './admin-player-auctions.service.js';

const now = new Date('2026-10-20T12:00:00.000Z');
function harness() {
  const batch: any = {
    id: 'batch-1', leagueId: 'league-1', groupBindingId: null, groupBinding: null,
    bidChannel: 'MINIPROGRAM', name: '提名拍卖', status: 'DRAFT', currentLotId: null, version: 1,
    startedAt: null, completedAt: null, cancelledAt: null, createdAt: now, updatedAt: now, lots: []
  };
  const tx: any = {
    $queryRaw: jest.fn(async () => []),
    playerAuctionBatch: {
      findFirst: jest.fn(async () => batch),
      updateMany: jest.fn(async () => ({ count: 1 }))
    },
    playerAuctionLot: {
      deleteMany: jest.fn(async () => ({ count: batch.lots.length })),
      createMany: jest.fn(async ({ data }: any) => {
        batch.lots = data.map((lot: any, index: number) => ({ ...lot, id: `lot-${index}`, status: 'QUEUED', version: 1,
          currentPrice: null, currentHighestBidId: null, deadlineAt: null, deadlineEpoch: 0, pausedRemainingMs: null,
          startedAt: null, closedAt: null, reviewedAt: null, bids: [], review: null }));
        return { count: data.length };
      })
    },
    footballPlayer: { findMany: jest.fn(async () => [{ id: 'player-1', nameZh: '瓦拉内', nameEn: null, shortName: null, nationality: '法国', club: '曼联' }]) },
    playerCard: { findMany: jest.fn(async () => [{ id: 'card-1', playerId: 'player-1', cardName: '传奇', position: 'CB', overallRating: 96, cardType: 'EPIC', status: 'ACTIVE', publishedAt: now, imageUrl: null }]) },
    playerNomination: { findMany: jest.fn(async () => [{ id: 'nomination-1', footballPlayerId: 'player-1' }]) },
    leaguePlayerOwnership: { findMany: jest.fn(async () => []) },
    wechatGroupBinding: { findFirst: jest.fn(async () => null) }
  };
  const receipts: any = { execute: jest.fn(async (_admin: string, _operation: string, _key: string, work: (client: any) => Promise<any>) => work(tx)) };
  const authorization: any = { requireLeagueAccess: jest.fn(async () => undefined) };
  const audit: any = { record: jest.fn(async () => undefined) };
  const state: any = {};
  const service = new AdminPlayerAuctionsService(tx, authorization, receipts, audit, state);
  return { service, batch, tx };
}

const input = { expectedVersion: 1, lots: [{ playerId: 'player-1', playerCardId: 'card-1', nominationId: 'nomination-1', displayOrder: 1, startingPrice: 50, minimumIncrement: 10 }] };

describe('nomination-sourced auction lots', () => {
  it('persists the source and rejects a nominee acquired before import', async () => {
    const valid = harness();
    await valid.service.replaceLots('admin-1', 'league-1', 'batch-1', input, 'valid');
    expect(valid.batch.lots[0]?.nominationId).toBe('nomination-1');
    const acquired = harness();
    acquired.tx.leaguePlayerOwnership.findMany.mockResolvedValueOnce([{ footballPlayerId: 'player-1' }]);
    await expect(acquired.service.replaceLots('admin-1', 'league-1', 'batch-1', input, 'acquired')).rejects.toMatchObject({ code: 'AUCTION_NOMINATION_INELIGIBLE' });
    expect(acquired.tx.playerAuctionLot.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects a withdrawn, cross-league, or mismatched nomination source', async () => {
    for (const nominations of [[], [{ id: 'nomination-1', footballPlayerId: 'other-player' }]]) {
      const { service, tx } = harness();
      tx.playerNomination.findMany.mockResolvedValueOnce(nominations);
      await expect(service.replaceLots('admin-1', 'league-1', 'batch-1', input, `invalid-${nominations.length}`)).rejects.toMatchObject({ code: 'AUCTION_NOMINATION_INELIGIBLE' });
    }
  });

  it('rechecks ownership before preparing a sourced lot', async () => {
    const { service, tx, batch } = harness();
    batch.lots = [{ nominationId: 'nomination-1', footballPlayerId: 'player-1' }];
    tx.leaguePlayerOwnership.findMany.mockResolvedValueOnce([{ footballPlayerId: 'player-1' }]);
    await expect(service.prepare('admin-1', 'league-1', 'batch-1', { expectedVersion: 1 }, 'prepare-owned')).rejects.toMatchObject({ code: 'AUCTION_NOMINATION_INELIGIBLE' });
    expect(tx.playerAuctionBatch.updateMany).not.toHaveBeenCalled();
  });
});
