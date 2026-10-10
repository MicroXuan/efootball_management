import { Inject, Injectable } from '@nestjs/common';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { WECHAT_BOT_CONFIG, type WechatBotRuntimeConfig } from '../wechat-bot/wechat-bot.config.js';
import { WechatOutboxService } from '../wechat-bot/wechat-outbox.service.js';
import { PlayerAuctionError } from './player-auction.errors.js';
import { PlayerAuctionLockRepository } from './player-auction-lock.repository.js';
import { PlayerAuctionStateService } from './player-auction-state.service.js';

@Injectable()
export class PlayerAuctionRecoveryService {
  private readonly unavailableDevices = new Set<string>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlayerAuctionStateService) private readonly state: PlayerAuctionStateService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(PlayerAuctionLockRepository) private readonly locks: PlayerAuctionLockRepository,
    @Inject(WechatOutboxService) private readonly outbox: WechatOutboxService,
    @Inject(WECHAT_BOT_CONFIG) private readonly config: WechatBotRuntimeConfig
  ) {}

  async onBridgeUnavailable(deviceId: string, reason: string) {
    if (this.unavailableDevices.has(deviceId)) return 0;
    this.unavailableDevices.add(deviceId);
    const batches = await this.prisma.playerAuctionBatch.findMany({
      where: { status: { in: ['ACTIVE', 'PAUSED'] }, groupBinding: { deviceId } },
      select: { id: true, groupBindingId: true }
    });
    for (const batch of batches) await this.state.enterRecovery(batch.groupBindingId, reason);
    return batches.length;
  }

  bridgeAvailable(deviceId: string) {
    this.unavailableDevices.delete(deviceId);
  }

  async scanUnavailableDevices() {
    const cutoff = new Date(Date.now() - this.config.heartbeatTimeoutMs);
    const devices = await this.prisma.wechatBotDevice.findMany({
      where: {
        OR: [
          { status: 'DISABLED' },
          { status: 'ACTIVE', OR: [
          { lastHeartbeatAt: null }, { lastHeartbeatAt: { lt: cutoff } },
          { circuitStatus: 'OPEN' }, { loginStatus: { not: 'LOGGED_IN' } }, { screenLocked: true }
          ] }
        ]
      },
      select: { id: true, status: true, circuitStatus: true, loginStatus: true, screenLocked: true, lastHeartbeatAt: true }
    });
    for (const device of devices) {
      const reason = device.status === 'DISABLED'
        ? 'DEVICE_DISABLED'
        : device.circuitStatus === 'OPEN'
        ? 'SEND_CIRCUIT_OPEN'
        : device.screenLocked
          ? 'WINDOW_SESSION_LOCKED'
          : device.loginStatus !== 'LOGGED_IN'
            ? 'WECHAT_NOT_LOGGED_IN'
            : 'HEARTBEAT_TIMEOUT';
      await this.onBridgeUnavailable(device.id, reason);
    }
  }

  async recoverOverdueOnBootstrap() {
    const groups = await this.prisma.playerAuctionBatch.findMany({
      where: { status: 'ACTIVE', lots: { some: { status: 'ACTIVE', deadlineAt: { lte: new Date() } } } },
      select: { groupBindingId: true }
    });
    for (const group of groups) await this.state.enterRecovery(group.groupBindingId, 'APPLICATION_RESTART_AMBIGUITY');
  }

  recover(batchId: string, actorUserId: string, announce = true) {
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.playerAuctionBatch.findUnique({
        where: { id: batchId }, include: { groupBinding: { select: { deviceId: true, wechatGroupId: true } } }
      });
      if (!batch || batch.status !== 'RECOVERY_REQUIRED' || !batch.currentLotId) {
        throw new PlayerAuctionError('AUCTION_RECOVERY_NOT_REQUIRED', '该拍卖不需要恢复', 409);
      }
      const allowed = await this.authorization.can(actorUserId, 'league.auction.manage', { type: 'LEAGUE', id: batch.leagueId });
      if (!allowed) throw new PlayerAuctionError('AUCTION_FORBIDDEN', '没有恢复该联赛拍卖的权限', 403);
      await this.locks.lockGroup(tx, batch.groupBindingId);
      await this.locks.lockBatch(tx, batch.id);
      await this.locks.lockLot(tx, batch.currentLotId);
      const lot = await tx.playerAuctionLot.findUnique({ where: { id: batch.currentLotId } });
      if (!lot || lot.status !== 'PAUSED') throw new PlayerAuctionError('AUCTION_STATE_INVALID', '恢复状态不一致', 409);
      const now = await this.locks.now(tx);
      const deadlineAt = new Date(now.getTime() + 30_000);
      await tx.playerAuctionLot.update({ where: { id: lot.id }, data: { status: 'ACTIVE', startedAt: now, deadlineAt, pausedRemainingMs: null, deadlineEpoch: { increment: 1 }, lastCountdownMark: 30, version: { increment: 1 } } });
      await tx.playerAuctionBatch.update({ where: { id: batch.id }, data: { status: 'ACTIVE', recoveryDetectedAt: null, recoveryReason: null, version: { increment: 1 } } });
      if (announce && batch.groupBinding) {
        await this.outbox.enqueue({
          deviceId: batch.groupBinding.deviceId, targetType: 'GROUP', targetId: batch.groupBinding.wechatGroupId,
          businessKey: `auction:${batch.id}:recovery:${lot.id}:${deadlineAt.getTime()}`,
          text: '拍卖已由管理员恢复，当前球员重新开始 30 秒倒计时。', priority: 500
        });
      }
      return { transition: 'RECOVERED' as const, batchId: batch.id, lotId: lot.id, deadlineAt };
    });
  }
}
