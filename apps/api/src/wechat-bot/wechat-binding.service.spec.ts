/* eslint-disable @typescript-eslint/no-explicit-any -- focused Prisma transaction doubles */
import { createHmac } from 'node:crypto';
import { jest } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import { WechatBindingService } from './wechat-binding.service.js';

const runtime = {
  outboxLeaseMs: 30_000,
  outboxMaxAttempts: 3,
  heartbeatTimeoutMs: 60_000,
  commandRetentionHours: 24,
  bindingCodePepper: 'test-binding-code-pepper-with-32-characters'
};

describe('WechatBindingService', () => {
  it('issues a single-use hashed code that expires in exactly five minutes and invalidates older codes', async () => {
    const created: any[] = [];
    const prisma: any = {
      $transaction: jest.fn(async (callback: any) => callback(prisma)),
      wechatBindingCode: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        create: jest.fn(async ({ data }: any) => {
          created.push(data);
          return data;
        })
      }
    };
    const before = Date.now();
    const service = new WechatBindingService(prisma, runtime);
    const result = await service.issue('user-1');
    const after = Date.now();

    expect(result.code).toMatch(/^\d{6}$/);
    expect(Date.parse(result.expiresAt)).toBeGreaterThanOrEqual(before + 300_000);
    expect(Date.parse(result.expiresAt)).toBeLessThanOrEqual(after + 300_000);
    expect(prisma.wechatBindingCode.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'user-1', consumedAt: null, invalidatedAt: null })
    }));
    expect(created[0]).not.toHaveProperty('code');
    expect(created[0].codeHash).toBe(createHmac('sha256', runtime.bindingCodePepper).update(result.code).digest('hex'));
  });

  it('returns status and disables the active binding on unbind', async () => {
    const binding = { id: 'binding-1', status: 'ACTIVE', boundAt: new Date(), device: { name: '联赛机器人' } };
    const prisma: any = {
      wechatIdentityBinding: {
        findFirst: jest.fn(async () => binding),
        updateMany: jest.fn(async () => ({ count: 1 }))
      }
    };
    const service = new WechatBindingService(prisma, runtime);
    await expect(service.status('user-1')).resolves.toMatchObject({ status: 'BOUND', deviceName: '联赛机器人' });
    await expect(service.unbind('user-1')).resolves.toEqual({ status: 'UNBOUND' });
    expect(prisma.wechatIdentityBinding.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1', status: 'ACTIVE' },
      data: expect.objectContaining({ status: 'DISABLED' })
    }));
  });

  it('rate-limits the sixth invalid binding attempt from one sender in ten minutes', async () => {
    const prisma: any = {
      wechatInboundMessage: { count: jest.fn(async () => 5) }
    };
    const service = new WechatBindingService(prisma, runtime);
    await expect(service.consume('device-1', 'wxid-member', '000000', 'inbound-6'))
      .rejects.toMatchObject({ status: 429 });
  });

  it('rejects a contact or user that already has another active binding', async () => {
    const code = '123456';
    const prisma: any = {
      $transaction: jest.fn(async (callback: any) => callback(prisma)),
      wechatInboundMessage: { count: jest.fn(async () => 0), update: jest.fn() },
      wechatBindingCode: {
        findUnique: jest.fn(async () => ({
          id: 'code-1', userId: 'user-1', expiresAt: new Date(Date.now() + 60_000),
          invalidatedAt: null, consumedAt: null, consumedByInboundId: null
        })),
        updateMany: jest.fn(async () => ({ count: 1 }))
      },
      wechatIdentityBinding: {
        findUnique: jest.fn(async ({ where }: any) => where.deviceId_wechatContactId
          ? { id: 'binding-other', userId: 'user-other', wechatContactId: 'wxid-member', status: 'ACTIVE' }
          : null)
      }
    };
    const service = new WechatBindingService(prisma, runtime);
    await expect(service.consume('device-1', 'wxid-member', code, 'inbound-1'))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('consumes a code atomically once and treats replay of the same inbound as idempotent', async () => {
    const code = '654321';
    let consumedByInboundId: string | null = null;
    const binding = { id: 'binding-1', deviceId: 'device-1', userId: 'user-1', status: 'ACTIVE' };
    const prisma: any = {
      $transaction: jest.fn(async (callback: any) => callback(prisma)),
      wechatInboundMessage: { count: jest.fn(async () => 0), update: jest.fn(async () => undefined) },
      wechatBindingCode: {
        findUnique: jest.fn(async () => ({
          id: 'code-1', userId: 'user-1', expiresAt: new Date(Date.now() + 60_000),
          invalidatedAt: null, consumedAt: consumedByInboundId ? new Date() : null, consumedByInboundId
        })),
        updateMany: jest.fn(async ({ data }: any) => {
          if (consumedByInboundId) return { count: 0 };
          consumedByInboundId = data.consumedByInboundId;
          return { count: 1 };
        })
      },
      wechatIdentityBinding: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async () => binding),
        findFirst: jest.fn(async () => binding),
        findFirstOrThrow: jest.fn(async () => binding)
      }
    };
    const service = new WechatBindingService(prisma, runtime);
    await expect(service.consume('device-1', 'wxid-member', code, 'inbound-1')).resolves.toEqual(binding);
    await expect(service.consume('device-1', 'wxid-member', code, 'inbound-1')).resolves.toEqual(binding);
    await expect(service.consume('device-1', 'wxid-member', code, 'inbound-2')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.wechatIdentityBinding.create).toHaveBeenCalledTimes(1);
  });
});
