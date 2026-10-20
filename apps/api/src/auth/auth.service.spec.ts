import { describe, expect, it, jest } from '@jest/globals';
import { AuthService } from './auth.service.js';

describe('AuthService', () => {
  it('stores one football nickname when a WeChat account is created', async () => {
    const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'user-1', status: 'ACTIVE', wechatOpenId: data.wechatOpenId,
      publicUserNo: data.publicUserNo, displayName: data.displayName
    }));
    const transaction = {
      $queryRaw: jest.fn(async () => []),
      user: { findUnique: jest.fn(async () => null), create, update: jest.fn() },
      publicUserNumberSequence: {
        findUnique: jest.fn(async () => ({ nextValue: 123 })),
        update: jest.fn(async () => undefined)
      }
    };
    const prisma = {
      user: { findUnique: jest.fn(async () => null) },
      $transaction: jest.fn(async (work: (tx: typeof transaction) => Promise<unknown>) => work(transaction))
    };
    const tokens = { accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 };
    const service = new AuthService(
      prisma as never,
      { exchangeCode: jest.fn(async () => ({ openId: 'wx-user' })) } as never,
      { issuePair: jest.fn(async () => tokens) } as never
    );

    await expect(service.loginWithWechat('code', {})).resolves.toEqual(tokens);
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      publicUserNo: '000123',
      displayName: expect.not.stringMatching(/^实况玩家$/)
    }) });
  });
});
