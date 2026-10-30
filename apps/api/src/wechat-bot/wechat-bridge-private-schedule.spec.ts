import { jest } from '@jest/globals';
import { WechatBridgeService } from './wechat-bridge.service.js';

describe('private schedule command intake', () => {
  const create = jest.fn(async () => ({ id: 'inbound-1' }));
  const prisma = { wechatInboundMessage: { findUnique: jest.fn(async () => null), create } };
  const service = new WechatBridgeService(prisma as never);

  beforeEach(() => create.mockClear());

  it.each(['赛程', '赛程2', '赛程 2', '赛程  2'])('accepts %s for private delivery', async (text) => {
    const result = await service.acceptBatch('device-1', { messages: [{
      messageId: `message-${text}`, conversationType: 'PRIVATE', conversationId: 'contact-1',
      senderId: 'contact-1', sentAt: new Date().toISOString(), messageType: 'TEXT', text
    }] } as never);
    expect(result.results[0]?.status).toBe('ACCEPTED');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ commandText: text }) }));
  });

  it.each(['赛程0', '赛程 abc'])('ignores invalid private page %s', async (text) => {
    const result = await service.acceptBatch('device-1', { messages: [{
      messageId: `message-${text}`, conversationType: 'PRIVATE', conversationId: 'contact-1',
      senderId: 'contact-1', sentAt: new Date().toISOString(), messageType: 'TEXT', text
    }] } as never);
    expect(result.results[0]?.status).toBe('IGNORED');
    expect(create).not.toHaveBeenCalled();
  });
});
