/* eslint-disable @typescript-eslint/no-explicit-any -- focused Prisma test doubles */
import { jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { WechatBridgeService } from './wechat-bridge.service.js';
import { WechatOutboxService } from './wechat-outbox.service.js';
import { WechatRetentionService } from './wechat-retention.service.js';

const config = {
  outboxLeaseMs: 30_000,
  outboxMaxAttempts: 3,
  heartbeatTimeoutMs: 60_000,
  commandRetentionHours: 24,
  bindingCodePepper: 'test-binding-code-pepper-with-32-characters'
};

describe('WechatBridgeService', () => {
  it('upserts observed groups from a heartbeat', async () => {
    const prisma: any = {
      wechatBotDevice: { update: jest.fn(async ({ data }: any) => data) },
      wechatObservedGroup: { upsert: jest.fn(async ({ create }: any) => create) },
      wechatGroupBinding: { findMany: jest.fn(async () => [{ wechatGroupId: 'room-1@chatroom', displayName: '测试群' }]) }
    };
    const service = new WechatBridgeService(prisma);
    const response = await service.heartbeat('device-1', {
      wechatAccountId: 'wxid_robot',
      wechatVersion: '4.1.15.13',
      loginStatus: 'LOGGED_IN',
      listenerWatermark: '42',
      screenLocked: false,
      outboundQueueDepth: 0,
      observedGroups: [{ wechatGroupId: 'room-1@chatroom', displayName: '测试群' }]
    });
    expect(prisma.wechatObservedGroup.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { deviceId_wechatGroupId: { deviceId: 'device-1', wechatGroupId: 'room-1@chatroom' } }
    }));
    expect(response.enabledGroups).toEqual([{ wechatGroupId: 'room-1@chatroom', displayName: '测试群' }]);
  });

  it('persists only enabled group commands and private binding commands, with duplicate results', async () => {
    const rows = new Map<string, any>();
    const prisma: any = {
      wechatInboundMessage: {
        findUnique: jest.fn(async ({ where }: any) => rows.get(`${where.deviceId_messageId.deviceId}:${where.deviceId_messageId.messageId}`) ?? null),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `inbound-${rows.size + 1}`, resultCode: null, ...data };
          rows.set(`${data.deviceId}:${data.messageId}`, row);
          return row;
        })
      },
      wechatGroupBinding: {
        findUnique: jest.fn(async ({ where }: any) => where.deviceId_wechatGroupId.wechatGroupId === 'enabled@chatroom'
          ? { id: 'binding-1', enabled: true }
          : null)
      }
    };
    const service = new WechatBridgeService(prisma);
    const base = {
      sentAt: '2026-10-09T12:00:00.000Z',
      messageType: 'TEXT' as const,
      senderId: 'wxid_member',
      sequence: '1'
    };
    const result = await service.acceptBatch('device-1', { messages: [
      { ...base, messageId: '1', conversationType: 'GROUP', conversationId: 'disabled@chatroom', text: '查询赛程' },
      { ...base, messageId: '2', conversationType: 'PRIVATE', conversationId: 'wxid_member', text: '你好' },
      { ...base, messageId: '3', conversationType: 'GROUP', conversationId: 'enabled@chatroom', text: '查询赛程' },
      { ...base, messageId: '4', conversationType: 'PRIVATE', conversationId: 'wxid_member', text: '绑定 012345' }
    ] });

    expect(result.results.map((item) => item.status)).toEqual(['IGNORED', 'IGNORED', 'ACCEPTED', 'ACCEPTED']);
    expect([...rows.values()].map((row) => row.commandText)).toEqual(['查询赛程', '绑定 012345']);

    const duplicate = await service.acceptBatch('device-1', { messages: [
      { ...base, messageId: '3', conversationType: 'GROUP', conversationId: 'enabled@chatroom', text: '查询赛程' }
    ] });
    expect(duplicate.results[0]).toMatchObject({ status: 'DUPLICATE', inboundId: 'inbound-1' });
    expect(prisma.wechatInboundMessage.create).toHaveBeenCalledTimes(2);
  });
});

describe('WechatOutboxService', () => {
  function createHarness(overrides: Record<string, unknown> = {}) {
    const messages = new Map<string, any>();
    const device = { id: 'device-1', status: 'ACTIVE', circuitStatus: 'CLOSED' };
    const prisma: any = {
      wechatBotDevice: {
        findUnique: jest.fn(async () => device),
        update: jest.fn(async ({ data }: any) => Object.assign(device, data))
      },
      wechatOutboxMessage: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.businessKey) return [...messages.values()].find((message) => message.businessKey === where.businessKey) ?? null;
          return messages.get(where.id) ?? null;
        }),
        findUniqueOrThrow: jest.fn(async ({ where }: any) => {
          const row = where.businessKey
            ? [...messages.values()].find((message) => message.businessKey === where.businessKey)
            : messages.get(where.id);
          if (!row) throw new Error('row not found');
          return row;
        }),
        create: jest.fn(async ({ data }: any) => {
          const duplicate = [...messages.values()].find((message) => message.businessKey === data.businessKey);
          if (duplicate) throw { code: 'P2002' };
          const row = { id: `outbox-${messages.size + 1}`, status: 'PENDING', attemptCount: 0, ...data };
          messages.set(row.id, row);
          return row;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const row = messages.get(where.id);
          if (!row || (where.status && row.status !== where.status)) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = messages.get(where.id);
          Object.assign(row, data, {
            attemptCount: typeof data.attemptCount === 'object' ? row.attemptCount + data.attemptCount.increment : data.attemptCount ?? row.attemptCount
          });
          return row;
        }),
        findMany: jest.fn(async () => [...messages.values()].filter((message) => message.status === 'PENDING'))
      },
      $transaction: jest.fn(async (operation: any) => Array.isArray(operation)
        ? Promise.all(operation)
        : operation(prisma)),
      ...overrides
    };
    return { service: new WechatOutboxService(prisma, config), prisma, messages, device };
  }

  const input = {
    deviceId: 'device-1',
    targetType: 'GROUP' as const,
    targetId: 'room-1@chatroom',
    businessKey: 'reply:inbound-1:page:1',
    text: '赛程如下',
    priority: 100
  };

  it('returns the original row for a duplicate business key', async () => {
    const { service } = createHarness();
    const first = await service.enqueue(input);
    const second = await service.enqueue(input);
    expect(second.id).toBe(first.id);
  });

  it('leases only pending messages for an active device and claims nothing with an open circuit', async () => {
    const { service, device } = createHarness();
    await service.enqueue(input);
    const claimed = await service.claim('device-1', 20);
    expect(claimed.messages).toHaveLength(1);
    expect(claimed.messages[0]?.text).toBe('赛程如下');

    device.circuitStatus = 'OPEN';
    expect(await service.claim('device-1', 20)).toEqual({ messages: [] });
  });

  it('requires a read-back id for SENT and opens the circuit at the maximum failed attempt', async () => {
    const { service, messages, device } = createHarness();
    const row = await service.enqueue(input);
    await expect(service.ack('device-1', row.id, { status: 'SENT' } as never)).rejects.toBeInstanceOf(BadRequestException);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await service.ack('device-1', row.id, {
        status: 'FAILED',
        errorCode: 'SEND_FAILED',
        errorMessage: 'send failed'
      });
    }
    expect(messages.get(row.id)?.status).toBe('FAILED');
    expect(device.circuitStatus).toBe('OPEN');
  });

  it('never retries an ambiguous send and opens the circuit immediately', async () => {
    const { service, messages, device } = createHarness();
    const row = await service.enqueue(input);

    await service.ack('device-1', row.id, {
      status: 'AMBIGUOUS',
      errorCode: 'WECHAT_SEND_UNCONFIRMED',
      errorMessage: 'send outcome requires operator reconciliation'
    });

    expect(messages.get(row.id)?.status).toBe('FAILED');
    expect(messages.get(row.id)?.attemptCount).toBe(1);
    expect(device.circuitStatus).toBe('OPEN');
  });
});

describe('WechatRetentionService', () => {
  it('deletes old nonce receipts and clears expired command text without deleting inbound rows', async () => {
    const prisma: any = {
      wechatBridgeRequestReceipt: { deleteMany: jest.fn(async () => ({ count: 2 })) },
      wechatInboundMessage: { updateMany: jest.fn(async () => ({ count: 3 })) }
    };
    const service = new WechatRetentionService(prisma, config);
    await service.cleanup();
    expect(prisma.wechatBridgeRequestReceipt.deleteMany).toHaveBeenCalledWith({
      where: { receivedAt: { lt: expect.any(Date) } }
    });
    expect(prisma.wechatInboundMessage.updateMany).toHaveBeenCalledWith({
      where: { receivedAt: { lt: expect.any(Date) }, commandText: { not: null } },
      data: { commandText: null }
    });
  });
});
