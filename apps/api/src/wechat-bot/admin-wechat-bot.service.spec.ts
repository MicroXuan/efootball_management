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
      $queryRaw: jest.fn(async () => [{ id: 'binding-1' }]),
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
          id: 'binding-1', version: 1, createdAt: now, updatedAt: now,
          capabilities: [], scheduleSources: [], ...data
        })),
        update: jest.fn(async ({ data }: any) => ({
          id: 'binding-1', deviceId: 'device-1', leagueId: 'league-1',
          wechatGroupId: 'room-1@chatroom', displayName: '测试群', version: 2,
          createdAt: now, updatedAt: now, capabilities: [], scheduleSources: [], ...data
        }))
      },
      wechatGroupCapability: {
        deleteMany: jest.fn(async () => ({ count: 0 })),
        createMany: jest.fn(async () => ({ count: 0 }))
      },
      wechatGroupScheduleSource: {
        deleteMany: jest.fn(async () => ({ count: 1 })),
        createMany: jest.fn(async () => ({ count: 1 })),
        findMany: jest.fn(async () => [{ competitionId: 'competition-1' }])
      },
      competition: {
        findMany: jest.fn(async () => [{ id: 'competition-1', name: '甲级联赛', status: 'IN_PROGRESS' }])
      },
      playerAuctionBatch: {
        findFirst: jest.fn(async () => null)
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

  it('returns every configured capability in league group bindings', async () => {
    const { service, prisma } = harness();
    prisma.wechatGroupBinding.findMany.mockResolvedValueOnce([{
      id: 'binding-1', deviceId: 'device-1', leagueId: 'league-1',
      wechatGroupId: 'room-1@chatroom', displayName: '测试群', enabled: true, version: 1,
      capabilities: [{ capability: 'SCHEDULE_QUERY' }, { capability: 'PLAYER_AUCTION' }],
      scheduleSources: [{ competitionId: 'competition-1' }],
      createdAt: now, updatedAt: now
    }]);

    const config = await service.getLeagueConfig('league-1');

    expect(config.bindings[0]?.capabilities).toEqual(['SCHEDULE_QUERY', 'PLAYER_AUCTION']);
    expect(prisma.wechatGroupBinding.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({ capabilities: expect.anything() })
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

  it.each([
    { enabled: true, capabilities: ['PLAYER_AUCTION'] as const },
    { enabled: false, capabilities: ['SCHEDULE_QUERY'] as const }
  ])('atomically replaces capabilities while retaining explicit schedule sources ($enabled, $capabilities)', async ({ enabled, capabilities }) => {
    const { service, prisma, audit } = harness();
    const result = await service.saveGroupBinding('admin-1', 'league-1', {
      deviceId: 'device-1', observedGroupId: 'observed-1', enabled,
      capabilities: [...capabilities],
      scheduleSourceIds: ['competition-1']
    });
    expect(prisma.wechatGroupCapability.deleteMany).toHaveBeenCalledWith({ where: { groupBindingId: 'binding-1' } });
    expect(prisma.wechatGroupCapability.createMany).toHaveBeenCalledWith({
      data: capabilities.map((capability) => ({ groupBindingId: 'binding-1', capability, createdByAdminId: 'admin-1' }))
    });
    expect(prisma.wechatGroupScheduleSource.deleteMany).toHaveBeenCalledWith({ where: { groupBindingId: 'binding-1' } });
    expect(prisma.wechatGroupScheduleSource.createMany).toHaveBeenCalledWith({
      data: [{ groupBindingId: 'binding-1', competitionId: 'competition-1', displayOrder: 0, createdByAdminId: 'admin-1' }]
    });
    expect(result.capabilities).toEqual(capabilities);
    expect(result.scheduleSourceIds).toEqual(['competition-1']);
    expect(audit.record).toHaveBeenCalledWith(prisma, expect.objectContaining({
      leagueId: 'league-1',
      action: 'admin.wechat-bot.group-binding-saved',
      metadata: expect.objectContaining({ capabilities })
    }));
  });

  it.each(['READY', 'ACTIVE', 'PAUSED', 'RECOVERY_REQUIRED'])('protects an auction-capable group from disabling during a %s batch', async (status) => {
    const { service, prisma } = harness();
    prisma.wechatGroupBinding.findUnique.mockResolvedValue({
      id: 'binding-1', deviceId: 'device-1', leagueId: 'league-1',
      wechatGroupId: 'room-1@chatroom', displayName: '测试群', enabled: true, version: 1,
      capabilities: [{ capability: 'PLAYER_AUCTION' }], createdAt: now, updatedAt: now
    });
    prisma.playerAuctionBatch.findFirst.mockResolvedValueOnce({ id: 'batch-1', status });

    await expect(service.saveGroupBinding('admin-1', 'league-1', {
      deviceId: 'device-1', observedGroupId: 'observed-1', enabled: false,
      capabilities: ['PLAYER_AUCTION'], scheduleSourceIds: []
    })).rejects.toMatchObject({ response: { code: 'WECHAT_GROUP_HAS_ACTIVE_AUCTION' } });
    expect(prisma.wechatGroupBinding.update).not.toHaveBeenCalled();
  });

  it('protects an auction-capable group from removing only its auction capability', async () => {
    const { service, prisma } = harness();
    prisma.wechatGroupBinding.findUnique.mockResolvedValue({
      id: 'binding-1', deviceId: 'device-1', leagueId: 'league-1',
      wechatGroupId: 'room-1@chatroom', displayName: '测试群', enabled: true, version: 1,
      capabilities: [{ capability: 'SCHEDULE_QUERY' }, { capability: 'PLAYER_AUCTION' }],
      createdAt: now, updatedAt: now
    });
    prisma.playerAuctionBatch.findFirst.mockResolvedValueOnce({ id: 'batch-1', status: 'ACTIVE' });

    await expect(service.saveGroupBinding('admin-1', 'league-1', {
      deviceId: 'device-1', observedGroupId: 'observed-1', enabled: true,
      capabilities: ['SCHEDULE_QUERY'], scheduleSourceIds: ['competition-1']
    })).rejects.toMatchObject({ response: { code: 'WECHAT_GROUP_HAS_ACTIVE_AUCTION' } });
  });

  it.each(['DRAFT', 'COMPLETED', 'CANCELLED'])('allows auction capability removal when batches are only %s', async (status) => {
    const { service, prisma } = harness();
    prisma.wechatGroupBinding.findUnique.mockResolvedValue({
      id: 'binding-1', deviceId: 'device-1', leagueId: 'league-1',
      wechatGroupId: 'room-1@chatroom', displayName: '测试群', enabled: true, version: 1,
      capabilities: [{ capability: 'SCHEDULE_QUERY' }, { capability: 'PLAYER_AUCTION' }],
      createdAt: now, updatedAt: now
    });
    prisma.playerAuctionBatch.findFirst.mockImplementation(async ({ where }: any) =>
      where.status.in.includes(status) ? { id: 'batch-1', status } : null
    );

    const result = await service.saveGroupBinding('admin-1', 'league-1', {
      deviceId: 'device-1', observedGroupId: 'observed-1', enabled: true,
      capabilities: ['SCHEDULE_QUERY'], scheduleSourceIds: ['competition-1']
    });

    expect(result.capabilities).toEqual(['SCHEDULE_QUERY']);
    expect(prisma.playerAuctionBatch.findFirst).toHaveBeenCalledWith({
      where: {
        groupBindingId: 'binding-1',
        status: { in: ['READY', 'ACTIVE', 'PAUSED', 'RECOVERY_REQUIRED'] }
      },
      select: { id: true }
    });
  });

  it('allows removing schedule capability while an auction is active', async () => {
    const { service, prisma } = harness();
    prisma.wechatGroupBinding.findUnique.mockResolvedValue({
      id: 'binding-1', deviceId: 'device-1', leagueId: 'league-1',
      wechatGroupId: 'room-1@chatroom', displayName: '测试群', enabled: true, version: 1,
      capabilities: [{ capability: 'SCHEDULE_QUERY' }, { capability: 'PLAYER_AUCTION' }],
      createdAt: now, updatedAt: now
    });

    const result = await service.saveGroupBinding('admin-1', 'league-1', {
      deviceId: 'device-1', observedGroupId: 'observed-1', enabled: true,
      capabilities: ['PLAYER_AUCTION'], scheduleSourceIds: []
    });

    expect(result.capabilities).toEqual(['PLAYER_AUCTION']);
    expect(prisma.playerAuctionBatch.findFirst).not.toHaveBeenCalled();
  });
});
