import { Inject, Injectable } from '@nestjs/common';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { WECHAT_BOT_CONFIG, type WechatBotRuntimeConfig } from '../wechat-bot/wechat-bot.config.js';
import { WechatOutboxService } from '../wechat-bot/wechat-outbox.service.js';
import { PlayerAuctionError } from './player-auction.errors.js';
import { PlayerAuctionLockRepository } from './player-auction-lock.repository.js';
import { assertAuctionPauseNotExpired } from './player-auction-pause.js';
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
    this.unavailableDevices.add(deviceId);
    const batches = await this.prisma.playerAuctionBatch.findMany({
      where: { bidChannel: 'WECHAT_GROUP', status: { in: ['ACTIVE', 'PAUSED'] }, groupBinding: { deviceId } },
      select: { id: true, groupBindingId: true }
    });
    let transitioned = 0;
    for (const batch of batches) {
      if (!batch.groupBindingId) continue;
      try {
        await this.state.enterRecovery(batch.groupBindingId, reason);
        transitioned += 1;
      } catch (error) {
        // A second worker tick can retain an ACTIVE/PAUSED snapshot after another
        // scanner has already moved the batch into recovery. That transition is
        // idempotently complete, so only suppress this precise stale-state race.
        if (!(error instanceof PlayerAuctionError) || error.code !== 'AUCTION_STATE_INVALID') throw error;
      }
    }
    return transitioned;
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
      where: { bidChannel: 'WECHAT_GROUP', status: 'ACTIVE', lots: { some: { status: 'ACTIVE', deadlineAt: { lte: new Date() } } } },
      select: { groupBindingId: true }
    });
    for (const group of groups) {
      if (group.groupBindingId) await this.state.enterRecovery(group.groupBindingId, 'APPLICATION_RESTART_AMBIGUITY');
    }
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
      if (batch.bidChannel !== 'WECHAT_GROUP') throw new PlayerAuctionError('AUCTION_RECOVERY_NOT_REQUIRED', '小程序拍卖不依赖微信群桥接恢复', 409);
      if (!batch.groupBindingId || !batch.groupBinding) {
        throw new PlayerAuctionError('AUCTION_GROUP_INVALID', '微信群拍卖缺少通知群', 409);
      }
      await this.locks.lockLeague(tx, batch.leagueId);
      await this.locks.lockGroup(tx, batch.groupBindingId);
      await this.locks.lockBatch(tx, batch.id);
      await this.locks.lockLot(tx, batch.currentLotId);
      const lot = await tx.playerAuctionLot.findUnique({ where: { id: batch.currentLotId } });
      if (!lot || lot.status !== 'PAUSED') throw new PlayerAuctionError('AUCTION_STATE_INVALID', '恢复状态不一致', 409);
      const now = await this.locks.now(tx);
      const lockedBatch = await tx.playerAuctionBatch.findUniqueOrThrow({ where: { id: batch.id } });
      assertAuctionPauseNotExpired(lockedBatch, now);
      const deadlineAt = new Date(now.getTime() + 30_000);
      await tx.playerAuctionLot.update({ where: { id: lot.id }, data: { status: 'ACTIVE', startedAt: now, deadlineAt, pausedRemainingMs: null, deadlineEpoch: { increment: 1 }, lastCountdownMark: 30, version: { increment: 1 } } });
      await tx.playerAuctionBatch.update({ where: { id: batch.id }, data: { status: 'ACTIVE', pausedAt: null, recoveryDetectedAt: null, recoveryReason: null, version: { increment: 1 } } });
      if (announce && batch.groupBinding) {
        await this.outbox.enqueue({
          deviceId: batch.groupBinding.deviceId, targetType: 'GROUP', targetId: batch.groupBinding.wechatGroupId,
          businessKey: `auction:${batch.id}:recovery:${lot.id}:${deadlineAt.getTime()}`,
          text: '拍卖已由管理员恢复，当前球员重新开始 30 秒倒计时。', priority: 500
        });
      }
      this.state.activity.wake();
      return { transition: 'RECOVERED' as const, batchId: batch.id, lotId: lot.id, deadlineAt };
    });
  }
}
