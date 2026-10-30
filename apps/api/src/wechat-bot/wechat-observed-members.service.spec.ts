import { describe, expect, it, jest } from '@jest/globals';
import { WechatObservedMembersService } from './wechat-observed-members.service.js';
import type { PrismaService } from '../database/prisma.service.js';

describe('member observation boundary', () => {
  it('ignores disabled groups and rejects future observations before persistence', async () => {
    const prisma = { $transaction: async (work: (tx: unknown) => unknown) => work(prisma),
      wechatGroupBinding: { findFirst: jest.fn(async () => null) } };
    const service = new WechatObservedMembersService(prisma as unknown as PrismaService);
    const member = { wechatGroupId: 'g@chatroom', wechatContactId: 'wxid_a', displayName: null, observedAt: '2026-01-01T00:00:00.000Z' };
    await expect(service.accept('device', { items: [member] })).resolves.toEqual({ processed: 1 });
    await expect(service.accept('device', { items: [{ ...member, observedAt: '2099-01-01T00:00:00.000Z' }] })).rejects.toThrow();
  });
});
