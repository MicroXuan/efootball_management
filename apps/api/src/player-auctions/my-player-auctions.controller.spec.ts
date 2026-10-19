import { GUARDS_METADATA } from '@nestjs/common/constants';
import { jest } from '@jest/globals';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { MyPlayerAuctionsController } from './my-player-auctions.controller.js';

const user = { id: '11111111-1111-4111-8111-111111111111', status: 'ACTIVE' as const };
const batchId = '22222222-2222-4222-8222-222222222222';
const lotId = '33333333-3333-4333-8333-333333333333';

describe('MyPlayerAuctionsController', () => {
  it('protects every participant auction route with user authentication', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, MyPlayerAuctionsController) as unknown[];
    expect(guards).toContain(JwtAuthGuard);
  });

  it('scopes reads and bids to the authenticated user and requires idempotency', async () => {
    const service = {
      list: jest.fn(async () => ({ items: [] })),
      listSales: jest.fn(async () => ({ items: [], nextCursor: null })),
      detail: jest.fn(async () => ({ batchId })),
      placeBid: jest.fn(async () => ({ id: 'bid-1' }))
    };
    const controller = new MyPlayerAuctionsController(service as never);
    const input = { amount: 120, lotId, deadlineEpoch: 4 };

    await controller.list(user, { status: 'active' });
    await controller.sales(user, { keyword: '车范根', limit: 20 });
    await controller.detail(user, batchId);
    await controller.bid(user, batchId, input, 'request-1');

    expect(service.list).toHaveBeenCalledWith(user.id, { status: 'active' });
    expect(service.listSales).toHaveBeenCalledWith(user.id, { keyword: '车范根', limit: 20 });
    expect(service.detail).toHaveBeenCalledWith(user.id, batchId);
    expect(service.placeBid).toHaveBeenCalledWith(user.id, batchId, input, 'request-1');
    expect(() => controller.bid(user, batchId, input, ' ')).toThrow('必须提供 Idempotency-Key 请求头');
  });
});
