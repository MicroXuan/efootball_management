/* eslint-disable @typescript-eslint/no-explicit-any -- focused service test doubles */
import { jest } from '@jest/globals';
import { WechatBridgeService } from './wechat-bridge.service.js';
import { WechatCommandRouterService } from './wechat-command-router.service.js';

describe('WechatCommandRouterService', () => {
  function harness(rowOverrides: Record<string, unknown> = {}) {
    const row = {
      id: 'inbound-1',
      deviceId: 'device-1',
      conversationType: 'GROUP',
      conversationId: 'room-1@chatroom',
      senderId: 'wxid-user',
      groupBindingId: 'group-binding-1',
      commandText: '帮助',
      processingStatus: 'PENDING',
      ...rowOverrides
    };
    const prisma: any = {
      wechatInboundMessage: {
        findUnique: jest.fn(async () => row),
        updateMany: jest.fn(async () => ({ count: 1 })),
        update: jest.fn(async ({ data }: any) => Object.assign(row, data))
      },
      wechatIdentityBinding: {
        findUnique: jest.fn(async () => ({ userId: 'user-1', status: 'ACTIVE' }))
      }
    };
    const bindings: any = { consume: jest.fn(async () => ({ userId: 'user-1' })) };
    const schedules: any = { query: jest.fn(async () => ['第1页', '第2页']) };
    const outbox: any = { enqueue: jest.fn(async (input: any) => input) };
    return { service: new WechatCommandRouterService(prisma, bindings, schedules, outbox), prisma, bindings, schedules, outbox, row };
  }

  it('replies to help and marks the inbound message processed', async () => {
    const { service, outbox, row } = harness();
    await service.route('inbound-1');
    expect(outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      targetType: 'GROUP',
      targetId: 'room-1@chatroom',
      businessKey: 'inbound:inbound-1:reply:1'
    }));
    expect(row).toMatchObject({ processingStatus: 'PROCESSED', resultCode: 'HELP_REPLIED' });
  });

  it('consumes private binding codes and replies privately', async () => {
    const { service, bindings, outbox, row } = harness({
      conversationType: 'PRIVATE',
      conversationId: 'wxid-user',
      groupBindingId: null,
      commandText: '绑定 012345'
    });
    await service.route('inbound-1');
    expect(bindings.consume).toHaveBeenCalledWith('device-1', 'wxid-user', '012345', 'inbound-1');
    expect(outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({ targetType: 'PRIVATE', text: '绑定成功。' }));
    expect(row.processingStatus).toBe('PROCESSED');
  });

  it('routes group and personal schedule queries, requiring an active identity for personal queries', async () => {
    const group = harness({ commandText: '查询赛程' });
    await group.service.route('inbound-1');
    expect(group.schedules.query).toHaveBeenCalledWith('group-binding-1');
    expect(group.outbox.enqueue).toHaveBeenCalledTimes(2);

    const mine = harness({ commandText: '我的赛程' });
    await mine.service.route('inbound-1');
    expect(mine.schedules.query).toHaveBeenCalledWith('group-binding-1', 'user-1');

    const unbound = harness({ commandText: '我的赛程' });
    unbound.prisma.wechatIdentityBinding.findUnique.mockResolvedValueOnce(null);
    await unbound.service.route('inbound-1');
    expect(unbound.outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({ text: '请先在小程序获取验证码，再私聊机器人发送：绑定 123456' }));
    expect(unbound.schedules.query).not.toHaveBeenCalled();
  });

  it('does not process an already handled message or an unsupported command twice', async () => {
    const processed = harness({ processingStatus: 'PROCESSED' });
    await processed.service.route('inbound-1');
    expect(processed.outbox.enqueue).not.toHaveBeenCalled();

    const ignored = harness({ commandText: '无效命令' });
    await ignored.service.route('inbound-1');
    expect(ignored.row).toMatchObject({ processingStatus: 'IGNORED', resultCode: 'COMMAND_IGNORED' });
    expect(ignored.outbox.enqueue).not.toHaveBeenCalled();
  });
});

describe('WechatBridgeService command dispatch', () => {
  it('routes a newly accepted inbound command exactly once and not on duplicate upload', async () => {
    const row = { id: 'inbound-1', resultCode: null };
    let lookupCount = 0;
    const prisma: any = {
      wechatInboundMessage: {
        findUnique: jest.fn(async () => (lookupCount++ === 0 ? null : row)),
        create: jest.fn(async () => row)
      },
      wechatGroupBinding: { findUnique: jest.fn(async () => ({ id: 'binding-1', enabled: true })) }
    };
    const router: any = { route: jest.fn(async () => undefined) };
    const bridge = new WechatBridgeService(prisma, router);
    const message = {
      messageId: 'message-1',
      conversationType: 'GROUP' as const,
      conversationId: 'room-1@chatroom',
      senderId: 'wxid-user',
      sentAt: '2026-10-09T12:00:00.000Z',
      messageType: 'TEXT' as const,
      text: '查询赛程'
    };

    await bridge.acceptBatch('device-1', { messages: [message] });
    await bridge.acceptBatch('device-1', { messages: [message] });

    expect(router.route).toHaveBeenCalledTimes(1);
    expect(router.route).toHaveBeenCalledWith('inbound-1');
  });
});
