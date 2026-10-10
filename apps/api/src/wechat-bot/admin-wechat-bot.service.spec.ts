/* eslint-disable @typescript-eslint/no-explicit-any -- focused Prisma service doubles */
import { jest } from '@jest/globals';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { compare } from 'bcryptjs';
import { AdminWechatBotService } from './admin-wechat-bot.service.js';

const now = new Date('2026-10-09T12:00:00.000Z');

function device(overrides: Record<string, unknown> = {}) {
  return {
    id: 'device-1',
    name: '联赛机器人',
    tokenHash: 'secret-hash',
    status: 'ACTIVE',
    loginStatus: 'LOGGED_IN',
    circuitStatus: 'CLOSED',
    circuitReason: null,
    lastHeartbeatAt: now,
    wechatVersion: '4.1.15.13',
    outboundQueueDepth: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe('AdminWechatBotService', () => {
  function harness(overrides: Record<string, unknown> = {}) {
    const currentDevice = device();
    const prisma: any = {
      $transaction: jest.fn(async (callback: any) => callback(prisma)),
      wechatBotDevice: {
        findMany: jest.fn(async () => [currentDevice]),
        findUnique: jest.fn(async () => currentDevice),
        create: jest.fn(async ({ data }: any) => device({ id: 'device-new', ...data })),
        update: jest.fn(async ({ data }: any) => Object.assign(currentDevice, data, { updatedAt: now }))
      },
      wechatObservedGroup: {
        findMany: jest.fn(async () => [{
          id: 'observed-1', deviceId: 'device-1', wechatGroupId: 'room-1@chatroom',
          displayName: '测试群', lastObservedAt: now
        }]),
        findUnique: jest.fn(async () => ({
          id: 'observed-1', deviceId: 'device-1', wechatGroupId: 'room-1@chatroom',
          displayName: '测试群', device: { status: 'ACTIVE' }
        }))
      },
      wechatGroupBinding: {
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({
          id: 'binding-1', version: 1, createdAt: now, updatedAt: now, scheduleSources: [], ...data
        })),
        update: jest.fn(async ({ data }: any) => ({
          id: 'binding-1', deviceId: 'device-1', leagueId: 'league-1',
          wechatGroupId: 'room-1@chatroom', displayName: '测试群', version: 2,
          createdAt: now, updatedAt: now, scheduleSources: [], ...data
        }))
      },
      wechatGroupScheduleSource: {
        deleteMany: jest.fn(async () => ({ count: 1 })),
        createMany: jest.fn(async () => ({ count: 1 })),
        findMany: jest.fn(async () => [{ competitionId: 'competition-1' }])
      },
      competition: {
        findMany: jest.fn(async () => [{ id: 'competition-1', name: '甲级联赛', status: 'IN_PROGRESS' }])
      },
      ...overrides
    };
    const audit: any = { record: jest.fn(async () => undefined) };
    return { service: new AdminWechatBotService(prisma, audit), prisma, audit, currentDevice };
  }

  it('creates a device with a hashed one-time token and audits every platform mutation', async () => {
    const { service, prisma, audit } = harness();
    const created = await service.createDevice('admin-1', { name: '新机器人' });
    expect(created.token.length).toBeGreaterThanOrEqual(32);
    const persistedHash = prisma.wechatBotDevice.create.mock.calls[0][0].data.tokenHash;
    expect(persistedHash).not.toBe(created.token);
    await expect(compare(created.token, persistedHash)).resolves.toBe(true);
    expect(created.device).not.toHaveProperty('tokenHash');

    await service.setDeviceStatus('admin-1', 'device-1', { status: 'DISABLED', reason: '维护' });
    const rotated = await service.rotateToken('admin-1', 'device-1');
    await service.resetCircuit('admin-1', 'device-1');
    expect(rotated.token).not.toBe(created.token);
    expect(audit.record).toHaveBeenCalledTimes(4);
    expect(audit.record).toHaveBeenCalledWith(prisma, expect.objectContaining({ action: 'admin.wechat-bot.device-token-rotated' }));
  });

  it('lists device and observed-group status without credential hashes or inbound text', async () => {
    const { service, prisma } = harness();
    const devices = await service.listDevices();
    const groups = await service.listObservedGroups('device-1');
    expect(devices.items[0]).not.toHaveProperty('tokenHash');
    expect(groups.items[0]).toEqual(expect.objectContaining({ displayName: '测试群' }));
    expect(prisma.wechatObservedGroup.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.not.objectContaining({ inboundMessages: expect.anything() })
    }));
  });

  it('rejects binding a group that already belongs to another league', async () => {
    const { service, prisma } = harness();
    prisma.wechatGroupBinding.findUnique.mockResolvedValueOnce({
      id: 'binding-other', leagueId: 'league-2', version: 1
    });
    await expect(service.saveGroupBinding('admin-1', 'league-1', {
      deviceId: 'device-1', observedGroupId: 'observed-1', enabled: true,
      capabilities: [],
      scheduleSourceIds: ['competition-1']
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects missing, cancelled, or cross-league schedule sources', async () => {
    const { service, prisma } = harness();
    prisma.competition.findMany.mockResolvedValueOnce([]);
    await expect(service.saveGroupBinding('admin-1', 'league-1', {
      deviceId: 'device-1', observedGroupId: 'observed-1', enabled: true,
      capabilities: [],
      scheduleSourceIds: ['competition-missing']
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.wechatGroupScheduleSource.deleteMany).not.toHaveBeenCalled();
  });

  it('atomically replaces schedule sources and audits the league mutation', async () => {
    const { service, prisma, audit } = harness();
    const result = await service.saveGroupBinding('admin-1', 'league-1', {
      deviceId: 'device-1', observedGroupId: 'observed-1', enabled: true,
      capabilities: [],
      scheduleSourceIds: ['competition-1']
    });
    expect(prisma.wechatGroupScheduleSource.deleteMany).toHaveBeenCalledWith({ where: { groupBindingId: 'binding-1' } });
    expect(prisma.wechatGroupScheduleSource.createMany).toHaveBeenCalledWith({
      data: [{ groupBindingId: 'binding-1', competitionId: 'competition-1', displayOrder: 0, createdByAdminId: 'admin-1' }]
    });
    expect(result.scheduleSourceIds).toEqual(['competition-1']);
    expect(audit.record).toHaveBeenCalledWith(prisma, expect.objectContaining({
      leagueId: 'league-1',
      action: 'admin.wechat-bot.group-binding-saved'
    }));
  });
});
