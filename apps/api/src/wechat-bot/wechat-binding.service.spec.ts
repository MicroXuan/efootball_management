import { expect, it, jest } from '@jest/globals';
import type { PrismaService } from '../database/prisma.service.js';
import { WechatBindingService } from './wechat-binding.service.js';
const runtime = { outboxLeaseMs: 30000, outboxMaxAttempts: 3, heartbeatTimeoutMs: 60000, commandRetentionHours: 24, bindingCodePepper: 'verify-binding-pepper-long-enough' };
it('refuses both new and previously issued codes without accessing the database', async () => {
  const service = new WechatBindingService({} as PrismaService, runtime);
  await expect(service.issue('user')).rejects.toMatchObject({ response: { code: 'WECHAT_BINDING_ADMIN_MANAGED' } });
  await expect(service.consume('device', 'wxid', '123456', 'inbound')).rejects.toMatchObject({ response: { code: 'WECHAT_BINDING_ADMIN_MANAGED' } });
});
it('keeps existing identities visible and increments their version on self-unbind', async () => {
  let state = { status: 'ACTIVE', version: 2, boundAt: new Date(), device: { name: '联赛机器人' } };
  const db = { wechatIdentityBinding: {
    findFirst: jest.fn(async () => state.status === 'ACTIVE' ? state : null),
    updateMany: jest.fn(async ({ data }: { data: { status: string; version: { increment: number } } }) => {
      state = { ...state, status: data.status, version: state.version + data.version.increment }; return { count: 1 };
    })
  } } as unknown as PrismaService;
  const service = new WechatBindingService(db, runtime);
  await expect(service.status('user')).resolves.toMatchObject({ status: 'BOUND', deviceName: '联赛机器人' });
  await service.unbind('user');
  expect(state.version).toBe(3);
  await expect(service.status('user')).resolves.toEqual({ status: 'UNBOUND' });
});
