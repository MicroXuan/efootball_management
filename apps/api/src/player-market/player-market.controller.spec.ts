import { jest } from '@jest/globals';
import { MyPlayerMarketController } from './my-player-market.controller.js';
import { AdminPlayerMarketController } from './admin-player-market.controller.js';

describe('player market controllers', () => {
  it('delegates public market queries using the authenticated user', async () => {
    const queries = { listMarket: jest.fn(async () => ({ items: [], nextCursor: null, activeTransferWindowId: null })) };
    const controller = new MyPlayerMarketController(queries as never, {} as never, {} as never);
    await controller.market({ id: 'user-1', status: 'ACTIVE' }, 'league-1', { seasonId: 'season-1', ownership: 'ALL', limit: 30 });
    expect(queries.listMarket).toHaveBeenCalledWith('user-1', 'league-1', expect.objectContaining({ seasonId: 'season-1' }));
  });

  it('requires idempotency keys for user and admin mutations', () => {
    const mine = new MyPlayerMarketController({} as never, {} as never, {} as never);
    expect(() => mine.submit({ id: 'user-1', status: 'ACTIVE' }, 'league-1', {} as never, undefined))
      .toThrow(expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REQUIRED' }));
    const admin = new AdminPlayerMarketController({} as never, {} as never);
    expect(() => admin.approve({ id: 'admin-1', status: 'ACTIVE', platformRole: null }, 'app-1', {} as never, undefined))
      .toThrow(expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REQUIRED' }));
  });
});
