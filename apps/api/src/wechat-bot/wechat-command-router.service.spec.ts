/* eslint-disable @typescript-eslint/no-explicit-any -- focused service test doubles */
import { jest } from '@jest/globals';
import { WechatBridgeService } from './wechat-bridge.service.js';
import { WechatCommandRouterService } from './wechat-command-router.service.js';
import { formatWechatHelp } from './wechat-message-formatter.js';

describe('WechatCommandRouterService', () => {
  function harness(
    rowOverrides: Record<string, unknown> = {},
    capabilities: Array<'SCHEDULE_QUERY' | 'PLAYER_AUCTION'> = ['SCHEDULE_QUERY', 'PLAYER_AUCTION'],
    bindingEnabled = true
  ) {
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
      },
      wechatGroupBinding: {
        findFirst: jest.fn(async () => bindingEnabled ? {
          id: 'group-binding-1',
          capabilities: capabilities.map((capability) => ({ capability }))
        } : null)
      }
    };
    const bindings: any = { consume: jest.fn(async () => ({ userId: 'user-1' })) };
    const schedules: any = { query: jest.fn(async () => ['第1页', '第2页']) };
    const outbox: any = { enqueue: jest.fn(async (input: any) => input) };
    const auction: any = { handle: jest.fn(async () => true) };
    const moduleRef: any = { get: jest.fn(() => auction) };
    return {
      service: new WechatCommandRouterService(prisma, bindings, schedules, outbox, moduleRef),
      prisma, bindings, schedules, outbox, auction, row
    };
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

  it('isolates schedule and auction commands by the selected group capabilities', async () => {
    const queryOnly = harness({ commandText: '查询赛程' }, ['SCHEDULE_QUERY']);
    await queryOnly.service.route('inbound-1');
    expect(queryOnly.schedules.query).toHaveBeenCalledWith('group-binding-1');
    expect(queryOnly.auction.handle).not.toHaveBeenCalled();

    const queryOnlyBid = harness({ commandText: '120' }, ['SCHEDULE_QUERY']);
    await queryOnlyBid.service.route('inbound-1');
    expect(queryOnlyBid.row).toMatchObject({ processingStatus: 'IGNORED', resultCode: 'AUCTION_CAPABILITY_DISABLED' });
    expect(queryOnlyBid.auction.handle).not.toHaveBeenCalled();
    expect(queryOnlyBid.outbox.enqueue).not.toHaveBeenCalled();

    const auctionOnly = harness({ commandText: '查询赛程' }, ['PLAYER_AUCTION']);
    await auctionOnly.service.route('inbound-1');
    expect(auctionOnly.row).toMatchObject({ processingStatus: 'IGNORED', resultCode: 'SCHEDULE_CAPABILITY_DISABLED' });
    expect(auctionOnly.schedules.query).not.toHaveBeenCalled();
    expect(auctionOnly.outbox.enqueue).not.toHaveBeenCalled();

    const auctionManager = harness({ commandText: '开始拍卖' }, ['PLAYER_AUCTION']);
    await auctionManager.service.route('inbound-1');
    expect(auctionManager.auction.handle).toHaveBeenCalledWith('inbound-1');
    expect(auctionManager.row).toMatchObject({ processingStatus: 'PROCESSED', resultCode: 'AUCTION_HANDLED' });

    const combinedBid = harness({ commandText: '120' });
    await combinedBid.service.route('inbound-1');
    expect(combinedBid.auction.handle).toHaveBeenCalledWith('inbound-1');
    const combinedSchedule = harness({ commandText: '我的赛程' });
    await combinedSchedule.service.route('inbound-1');
    expect(combinedSchedule.schedules.query).toHaveBeenCalledWith('group-binding-1', 'user-1');
  });

  it('silently ignores recognized commands for groups with no capabilities', async () => {
    const schedule = harness({ commandText: '我的赛程' }, []);
    await schedule.service.route('inbound-1');
    expect(schedule.row).toMatchObject({ processingStatus: 'IGNORED', resultCode: 'SCHEDULE_CAPABILITY_DISABLED' });
    expect(schedule.prisma.wechatIdentityBinding.findUnique).not.toHaveBeenCalled();
    expect(schedule.outbox.enqueue).not.toHaveBeenCalled();

    const bid = harness({ commandText: '88' }, []);
    await bid.service.route('inbound-1');
    expect(bid.row).toMatchObject({ processingStatus: 'IGNORED', resultCode: 'AUCTION_CAPABILITY_DISABLED' });
    expect(bid.auction.handle).not.toHaveBeenCalled();
    expect(bid.outbox.enqueue).not.toHaveBeenCalled();
  });

  it('ignores disabled and unbound groups before invoking any command handler', async () => {
    const disabled = harness({ commandText: '开始拍卖' }, ['PLAYER_AUCTION'], false);
    await disabled.service.route('inbound-1');
    expect(disabled.row).toMatchObject({ processingStatus: 'IGNORED', resultCode: 'GROUP_NOT_BOUND' });
    expect(disabled.auction.handle).not.toHaveBeenCalled();
    expect(disabled.outbox.enqueue).not.toHaveBeenCalled();

    const unbound = harness({ commandText: '查询赛程', groupBindingId: null });
    await unbound.service.route('inbound-1');
    expect(unbound.row).toMatchObject({ processingStatus: 'IGNORED', resultCode: 'GROUP_NOT_BOUND' });
    expect(unbound.prisma.wechatGroupBinding.findFirst).not.toHaveBeenCalled();
    expect(unbound.schedules.query).not.toHaveBeenCalled();
  });

  it('formats help from only the capabilities enabled for the current group', () => {
    const queryOnly = formatWechatHelp(['SCHEDULE_QUERY']);
    expect(queryOnly).toContain('查询赛程');
    expect(queryOnly).toContain('我的赛程');
    expect(queryOnly).not.toContain('纯数字出价');

    const auctionOnly = formatWechatHelp(['PLAYER_AUCTION']);
    expect(auctionOnly).toContain('开始拍卖');
    expect(auctionOnly).toContain('暂停拍卖');
    expect(auctionOnly).toContain('继续拍卖');
    expect(auctionOnly).toContain('取消拍卖');
    expect(auctionOnly).toContain('纯数字出价');
    expect(auctionOnly).not.toContain('查询赛程');
    expect(auctionOnly).not.toContain('下一位');

    const combined = formatWechatHelp(['SCHEDULE_QUERY', 'PLAYER_AUCTION']);
    expect(combined).toContain('查询赛程');
    expect(combined).toContain('纯数字出价');
    expect(formatWechatHelp([])).toContain('本群暂未启用机器人功能');
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

  it('does not accept the retired next-lot command from a group', async () => {
    const prisma: any = {
      wechatInboundMessage: {
        findUnique: jest.fn(async () => null),
        create: jest.fn()
      },
      wechatGroupBinding: {
        findUnique: jest.fn(async () => ({ id: 'binding-1', enabled: true }))
      }
    };
    const router: any = { route: jest.fn() };
    const bridge = new WechatBridgeService(prisma, router);

    const result = await bridge.acceptBatch('device-1', { messages: [{
      messageId: 'message-next',
      conversationType: 'GROUP',
      conversationId: 'room-1@chatroom',
      senderId: 'wxid-user',
      sentAt: '2026-10-09T12:00:00.000Z',
      messageType: 'TEXT',
      text: '下一位'
    }] });

    expect(result.results[0]).toMatchObject({ status: 'IGNORED', inboundId: null });
    expect(prisma.wechatInboundMessage.create).not.toHaveBeenCalled();
    expect(router.route).not.toHaveBeenCalled();
  });
});
