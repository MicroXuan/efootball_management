import { randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateWechatBotDeviceRequest,
  SaveWechatGroupBindingRequest,
  UpdateWechatBotDeviceStatusRequest
} from '@efm/contracts';
import { hash } from 'bcryptjs';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';

const BCRYPT_COST = 10;

type DeviceViewInput = {
  id: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
  loginStatus: 'UNKNOWN' | 'LOGGED_IN' | 'LOGGED_OUT';
  circuitStatus: 'CLOSED' | 'OPEN';
  circuitReason: string | null;
  lastHeartbeatAt: Date | null;
  wechatVersion: string | null;
  outboundQueueDepth: number;
  createdAt: Date;
  updatedAt: Date;
};

type GroupBindingViewInput = {
  id: string;
  deviceId: string;
  leagueId: string;
  wechatGroupId: string;
  displayName: string;
  enabled: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  scheduleSources?: Array<{ competitionId: string }>;
};

@Injectable()
export class AdminWechatBotService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService
  ) {}

  async listDevices() {
    const devices = await this.prisma.wechatBotDevice.findMany({
      select: this.deviceSelect(),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });
    return { items: devices.map((device) => this.deviceView(device)) };
  }

  async createDevice(adminId: string, input: CreateWechatBotDeviceRequest) {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = await hash(token, BCRYPT_COST);
    const device = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.wechatBotDevice.create({
        data: { name: input.name, tokenHash, createdByAdminId: adminId }
      });
      await this.audit.record(transaction, {
        actorAdminId: adminId,
        action: 'admin.wechat-bot.device-created',
        resourceType: 'WechatBotDevice',
        resourceId: created.id,
        metadata: { name: created.name }
      });
      return created;
    });
    return { device: this.deviceView(device), token };
  }

  async setDeviceStatus(adminId: string, deviceId: string, input: UpdateWechatBotDeviceStatusRequest) {
    await this.requireDevice(deviceId);
    const device = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.wechatBotDevice.update({
        where: { id: deviceId },
        data: { status: input.status }
      });
      await this.audit.record(transaction, {
        actorAdminId: adminId,
        action: input.status === 'ACTIVE'
          ? 'admin.wechat-bot.device-enabled'
          : 'admin.wechat-bot.device-disabled',
        resourceType: 'WechatBotDevice',
        resourceId: deviceId,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        metadata: { status: input.status }
      });
      return updated;
    });
    return this.deviceView(device);
  }

  async rotateToken(adminId: string, deviceId: string) {
    await this.requireDevice(deviceId);
    const token = randomBytes(32).toString('base64url');
    const tokenHash = await hash(token, BCRYPT_COST);
    const device = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.wechatBotDevice.update({
        where: { id: deviceId },
        data: { tokenHash }
      });
      await this.audit.record(transaction, {
        actorAdminId: adminId,
        action: 'admin.wechat-bot.device-token-rotated',
        resourceType: 'WechatBotDevice',
        resourceId: deviceId
      });
      return updated;
    });
    return { device: this.deviceView(device), token };
  }

  async resetCircuit(adminId: string, deviceId: string) {
    await this.requireDevice(deviceId);
    const device = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.wechatBotDevice.update({
        where: { id: deviceId },
        data: { circuitStatus: 'CLOSED', circuitReason: null, circuitOpenedAt: null }
      });
      await this.audit.record(transaction, {
        actorAdminId: adminId,
        action: 'admin.wechat-bot.device-circuit-reset',
        resourceType: 'WechatBotDevice',
        resourceId: deviceId
      });
      return updated;
    });
    return this.deviceView(device);
  }

  async listObservedGroups(deviceId: string) {
    await this.requireDevice(deviceId);
    const groups = await this.prisma.wechatObservedGroup.findMany({
      where: { deviceId },
      select: {
        id: true,
        deviceId: true,
        wechatGroupId: true,
        displayName: true,
        lastObservedAt: true
      },
      orderBy: [{ lastObservedAt: 'desc' }, { id: 'desc' }]
    });
    return { items: groups.map((group) => ({ ...group, lastObservedAt: group.lastObservedAt.toISOString() })) };
  }

  async getLeagueConfig(leagueId: string) {
    const [bindings, devices, observedGroups, competitions] = await Promise.all([
      this.prisma.wechatGroupBinding.findMany({
        where: { leagueId },
        include: { scheduleSources: { select: { competitionId: true }, orderBy: { displayOrder: 'asc' } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
      }),
      this.prisma.wechatBotDevice.findMany({
        where: { status: 'ACTIVE' },
        select: this.deviceSelect(),
        orderBy: [{ name: 'asc' }, { id: 'asc' }]
      }),
      this.prisma.wechatObservedGroup.findMany({
        where: { device: { status: 'ACTIVE' } },
        select: { id: true, deviceId: true, wechatGroupId: true, displayName: true, lastObservedAt: true },
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }]
      }),
      this.prisma.competition.findMany({
        where: { season: { leagueId }, status: { not: 'CANCELLED' } },
        select: { id: true, name: true, status: true },
        orderBy: [{ startsAt: 'desc' }, { id: 'desc' }]
      })
    ]);
    return {
      bindings: bindings.map((binding) => this.bindingView(binding)),
      devices: devices.map((device) => this.deviceView(device)),
      observedGroups: observedGroups.map((group) => ({
        ...group,
        lastObservedAt: group.lastObservedAt.toISOString()
      })),
      scheduleSourceOptions: competitions
    };
  }

  async saveGroupBinding(adminId: string, leagueId: string, input: SaveWechatGroupBindingRequest) {
    const observed = await this.prisma.wechatObservedGroup.findUnique({
      where: { id: input.observedGroupId },
      include: { device: { select: { status: true } } }
    });
    if (!observed || observed.deviceId !== input.deviceId || observed.device.status !== 'ACTIVE') {
      throw new BadRequestException({ code: 'WECHAT_GROUP_NOT_AVAILABLE', message: '微信群或机器人设备不可用' });
    }
    const existing = await this.prisma.wechatGroupBinding.findUnique({
      where: {
        deviceId_wechatGroupId: {
          deviceId: input.deviceId,
          wechatGroupId: observed.wechatGroupId
        }
      }
    });
    if (existing && existing.leagueId !== leagueId) {
      throw new ConflictException({ code: 'WECHAT_GROUP_ALREADY_BOUND', message: '该微信群已绑定其他联赛' });
    }
    if (existing && input.expectedVersion !== undefined && existing.version !== input.expectedVersion) {
      throw new ConflictException({ code: 'VERSION_CONFLICT', message: '配置已更新，请刷新后重试' });
    }

    const competitions = input.scheduleSourceIds.length > 0
      ? await this.prisma.competition.findMany({
          where: {
            id: { in: input.scheduleSourceIds },
            season: { leagueId },
            status: { not: 'CANCELLED' }
          },
          select: { id: true }
        })
      : [];
    if (competitions.length !== input.scheduleSourceIds.length) {
      throw new BadRequestException({
        code: 'INVALID_SCHEDULE_SOURCE',
        message: '赛程来源不存在、已取消或不属于当前联赛'
      });
    }

    return this.prisma.$transaction(async (transaction) => {
      const binding = existing
        ? await transaction.wechatGroupBinding.update({
            where: { id: existing.id },
            data: {
              observedGroupId: observed.id,
              displayName: observed.displayName,
              enabled: input.enabled,
              lastConfirmedAt: new Date(),
              version: { increment: 1 }
            }
          })
        : await transaction.wechatGroupBinding.create({
            data: {
              deviceId: input.deviceId,
              observedGroupId: observed.id,
              wechatGroupId: observed.wechatGroupId,
              displayName: observed.displayName,
              leagueId,
              enabled: input.enabled
            }
          });
      await transaction.wechatGroupScheduleSource.deleteMany({ where: { groupBindingId: binding.id } });
      if (input.scheduleSourceIds.length > 0) {
        await transaction.wechatGroupScheduleSource.createMany({
          data: input.scheduleSourceIds.map((competitionId, displayOrder) => ({
            groupBindingId: binding.id,
            competitionId,
            displayOrder,
            createdByAdminId: adminId
          }))
        });
      }
      await this.audit.record(transaction, {
        actorAdminId: adminId,
        leagueId,
        action: 'admin.wechat-bot.group-binding-saved',
        resourceType: 'WechatGroupBinding',
        resourceId: binding.id,
        metadata: {
          deviceId: input.deviceId,
          observedGroupId: input.observedGroupId,
          enabled: input.enabled,
          scheduleSourceIds: input.scheduleSourceIds
        }
      });
      return this.bindingView({ ...binding, scheduleSources: input.scheduleSourceIds.map((competitionId) => ({ competitionId })) });
    });
  }

  private async requireDevice(deviceId: string) {
    const device = await this.prisma.wechatBotDevice.findUnique({ where: { id: deviceId }, select: { id: true } });
    if (!device) throw new NotFoundException({ code: 'WECHAT_BOT_DEVICE_NOT_FOUND', message: '机器人设备不存在' });
    return device;
  }

  private deviceSelect() {
    return {
      id: true,
      name: true,
      status: true,
      loginStatus: true,
      circuitStatus: true,
      circuitReason: true,
      lastHeartbeatAt: true,
      wechatVersion: true,
      outboundQueueDepth: true,
      createdAt: true,
      updatedAt: true
    } as const;
  }

  private deviceView(device: DeviceViewInput) {
    return {
      id: device.id,
      name: device.name,
      status: device.status,
      loginStatus: device.loginStatus,
      circuitStatus: device.circuitStatus,
      circuitReason: device.circuitReason,
      lastHeartbeatAt: device.lastHeartbeatAt?.toISOString() ?? null,
      wechatVersion: device.wechatVersion,
      outboundQueueDepth: device.outboundQueueDepth,
      createdAt: device.createdAt.toISOString(),
      updatedAt: device.updatedAt.toISOString()
    };
  }

  private bindingView(binding: GroupBindingViewInput) {
    return {
      id: binding.id,
      deviceId: binding.deviceId,
      leagueId: binding.leagueId,
      wechatGroupId: binding.wechatGroupId,
      displayName: binding.displayName,
      enabled: binding.enabled,
      version: binding.version,
      scheduleSourceIds: binding.scheduleSources?.map((source) => source.competitionId) ?? [],
      createdAt: binding.createdAt.toISOString(),
      updatedAt: binding.updatedAt.toISOString()
    };
  }
}
