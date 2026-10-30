/* eslint-disable @typescript-eslint/no-explicit-any -- isolated Prisma doubles */
import { jest } from '@jest/globals';
import { Prisma } from '../generated/prisma/client.js';
import { WechatBridgeHeartbeatSchema, AdminWechatBotDeviceSchema } from '@efm/contracts';
import { WechatBridgeService } from './wechat-bridge.service.js';

it('persists receiver diagnostics and clears stale diagnostics for older clients', async () => {
  const prisma: any = {
    $queryRaw: jest.fn(async () => []),
    wechatBotDevice: { findUniqueOrThrow: jest.fn(async () => ({ wechatAccountId: 'robot' })), update: jest.fn(async () => ({})) },
    wechatObservedGroup: { upsert: jest.fn() },
    wechatGroupBinding: { findMany: jest.fn(async () => []) }
  };
  prisma.$transaction = async (work: any) => work(prisma);
  const service = new WechatBridgeService(prisma);
  const input = { wechatAccountId: 'robot', wechatVersion: '4.1', loginStatus: 'LOGGED_IN', screenLocked: false, outboundQueueDepth: 0, observedGroups: [] };
  const health = { status: 'RECOVERING', errorCode: 'WECHAT_DATABASE_UNAVAILABLE', lastSuccessAt: '2026-10-30T14:00:00Z' };
  await service.heartbeat('device', WechatBridgeHeartbeatSchema.parse({ ...input, receiverHealth: health }));
  expect(prisma.wechatBotDevice.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ receiverHealth: health }) }));
  await service.heartbeat('device', WechatBridgeHeartbeatSchema.parse(input));
  expect(prisma.wechatBotDevice.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ receiverHealth: Prisma.DbNull }) }));
  expect(AdminWechatBotDeviceSchema.shape.receiverHealth.parse(health)).toEqual(health);
  expect(() => WechatBridgeHeartbeatSchema.parse({ ...input, receiverHealth: { ...health, errorCode: 'private exception content' } })).toThrow();
});
