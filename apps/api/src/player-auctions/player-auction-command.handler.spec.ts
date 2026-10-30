import { jest } from '@jest/globals';
/* eslint-disable @typescript-eslint/no-explicit-any -- focused command-router test doubles */
import { PlayerAuctionCommandHandler } from './player-auction-command.handler.js';
import { PlayerAuctionMessageFormatter } from './player-auction-message.formatter.js';
import { PlayerAuctionError } from './player-auction.errors.js';

describe('PlayerAuctionCommandHandler', () => {
  function harness(commandText: string, identity: any = { userId: 'user-1', status: 'ACTIVE' }) {
    const inbound: any = { id: 'in-1', deviceId: 'device-1', conversationType: 'GROUP', conversationId: 'room@chatroom', senderId: 'wx-1', groupBindingId: 'group-1', commandText };
    const prisma: any = { wechatInboundMessage: { findUnique: jest.fn(async () => inbound) }, wechatIdentityBinding: { findUnique: jest.fn(async () => identity) } };
    const state: any = { start: jest.fn(async () => ({ transition: 'STARTED', lotId: 'lot-1' })), pause: jest.fn(), resume: jest.fn(), cancel: jest.fn() };
    const bids: any = { placeBid: jest.fn(async (_id: string, amount: number) => ({ result: 'VALID', amount, teamName: '申花' })) };
    const recovery: any = { recover: jest.fn() };
    const outbox: any = { enqueue: jest.fn(async () => undefined) };
    return { handler: new PlayerAuctionCommandHandler(prisma, state, bids, recovery, outbox, new PlayerAuctionMessageFormatter()), state, bids, outbox };
  }

  it('matches only exact manager commands and produces one reply', async () => {
    const { handler, state, outbox } = harness('开始拍卖');
    await expect(handler.handle('in-1')).resolves.toBe(true);
    expect(state.start).not.toHaveBeenCalled();
    expect(outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('仅限管理员私聊') }));
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);

    const mixed = harness('请开始拍卖');
    await expect(mixed.handler.handle('in-1')).resolves.toBe(false);
    await expect(harness('下一位').handler.handle('in-1')).resolves.toBe(false);
  });

  it('accepts pure decimal bids and delegates unbound auditing to the bid service', async () => {
    const { handler, bids, outbox } = harness('120', null);
    await expect(handler.handle('in-1')).resolves.toBe(true);
    expect(bids.placeBid).toHaveBeenCalledWith('in-1', 120);
    expect(outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({ text: '【申花】出价有效：120，倒计时重置为 30 秒。' }));
    await expect(harness('120元').handler.handle('in-1')).resolves.toBe(false);
  });

  it('directs group bidders to the miniprogram room for app-channel batches', async () => {
    const setup = harness('120');
    setup.bids.placeBid.mockRejectedValueOnce(
      new PlayerAuctionError('AUCTION_CHANNEL_MISMATCH', '当前拍卖仅接受小程序出价', 409)
    );
    await setup.handler.handle('in-1');
    expect(setup.outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      text: '本批次请点击小程序拍卖大厅出价。'
    }));
  });
});
