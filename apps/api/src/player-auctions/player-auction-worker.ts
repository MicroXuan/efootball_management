import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { WechatOutboxService } from '../wechat-bot/wechat-outbox.service.js';
import { PlayerAuctionClock } from './player-auction-clock.js';
import { PlayerAuctionLockRepository } from './player-auction-lock.repository.js';
import { PlayerAuctionRecoveryService } from './player-auction-recovery.service.js';
import { PlayerAuctionMessageFormatter } from './player-auction-message.formatter.js';

const MARKS = [20, 10, 3, 2, 1] as const;
const FULL_DURATION_MS = 30_000;
const RESULT_PRIORITY = 600;
const FOLLOW_UP_PRIORITY = 500;

@Injectable()
export class PlayerAuctionWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlayerAuctionClock) private readonly clock: PlayerAuctionClock,
    @Inject(PlayerAuctionLockRepository) private readonly locks: PlayerAuctionLockRepository,
    @Inject(WechatOutboxService) private readonly outbox: WechatOutboxService,
    @Inject(PlayerAuctionRecoveryService) private readonly recovery: PlayerAuctionRecoveryService,
    @Inject(PlayerAuctionMessageFormatter) private readonly formatter: PlayerAuctionMessageFormatter
  ) {}

  async onApplicationBootstrap() {
    await this.recovery.recoverOverdueOnBootstrap();
    this.timer = setInterval(() => void this.tick(), 500);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    await this.recovery.scanUnavailableDevices();
    const now = this.clock.now();
    const lots = await this.prisma.playerAuctionLot.findMany({
      where: { status: 'ACTIVE', deadlineAt: { not: null } },
      include: { batch: { include: { groupBinding: { select: { deviceId: true, wechatGroupId: true } } } } },
      orderBy: [{ deadlineAt: 'asc' }, { id: 'asc' }],
      take: 100
    });
    for (const lot of lots) {
      if (!lot.deadlineAt) continue;
      const remainingMs = lot.deadlineAt.getTime() - now.getTime();
      if (remainingMs <= 0) {
        await this.closeDueLot(lot.id, lot.deadlineEpoch);
        continue;
      }
      const remainingSeconds = Math.ceil(remainingMs / 1_000);
      const previous = lot.lastCountdownMark ?? 30;
      const crossed = MARKS.filter((mark) => mark < previous && remainingSeconds <= mark);
      const mark = crossed.length ? crossed.at(-1)! : null;
      if (mark === null) continue;
      const advanced = await this.prisma.playerAuctionLot.updateMany({
        where: { id: lot.id, status: 'ACTIVE', deadlineEpoch: lot.deadlineEpoch, lastCountdownMark: previous },
        data: { lastCountdownMark: mark }
      });
      if (advanced.count !== 1) continue;
      const congestion = await this.prisma.wechatOutboxMessage.count({
        where: { deviceId: lot.batch.groupBinding.deviceId, status: { in: ['PENDING', 'LEASED'] } }
      });
      if (congestion >= 50) continue;
      await this.outbox.enqueue({
        deviceId: lot.batch.groupBinding.deviceId, targetType: 'GROUP', targetId: lot.batch.groupBinding.wechatGroupId,
        businessKey: `auction:${lot.id}:epoch:${lot.deadlineEpoch}:countdown:${mark}`,
        text: this.formatter.countdown(mark), priority: 400
      });
    }
  }

  async closeDueLot(lotId: string, epoch: number) {
    return this.prisma.$transaction(async (tx) => {
      await this.locks.lockLot(tx, lotId);
      const lot = await tx.playerAuctionLot.findUnique({
        where: { id: lotId },
        include: { currentHighestBid: { include: { leagueTeam: { select: { name: true } } } } }
      });
      if (!lot || lot.status !== 'ACTIVE' || lot.deadlineEpoch !== epoch || !lot.deadlineAt) return false;
      await this.locks.lockBatch(tx, lot.batchId);
      const batch = await tx.playerAuctionBatch.findUnique({
        where: { id: lot.batchId },
        include: { groupBinding: { select: { deviceId: true, wechatGroupId: true } } }
      });
      if (!batch || batch.status !== 'ACTIVE' || batch.currentLotId !== lot.id) return false;
      const now = await this.locks.now(tx);
      if (lot.deadlineAt.getTime() > now.getTime()) return false;
      const update = await tx.playerAuctionLot.updateMany({
        where: { id: lotId, status: 'ACTIVE', deadlineEpoch: epoch },
        data: { status: lot.currentHighestBidId ? 'PENDING_REVIEW' : 'NO_BID', deadlineAt: null, closedAt: now, version: { increment: 1 } }
      });
      if (update.count !== 1) return false;
      const next = await tx.playerAuctionLot.findFirst({
        where: { batchId: batch.id, status: 'QUEUED' },
        orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }]
      });
      let nextEpoch: number | null = null;
      if (next) {
        await this.locks.lockLot(tx, next.id);
        const deadlineAt = new Date(now.getTime() + FULL_DURATION_MS);
        nextEpoch = next.deadlineEpoch + 1;
        const nextUpdate = await tx.playerAuctionLot.updateMany({
          where: { id: next.id, status: 'QUEUED', deadlineEpoch: next.deadlineEpoch },
          data: {
            status: 'ACTIVE',
            startedAt: now,
            deadlineAt,
            deadlineEpoch: nextEpoch,
            lastCountdownMark: 30,
            pausedRemainingMs: null,
            version: { increment: 1 }
          }
        });
        if (nextUpdate.count !== 1) throw new Error('AUCTION_NEXT_LOT_CONFLICT');
        await tx.playerAuctionBatch.update({
          where: { id: batch.id },
          data: { status: 'ACTIVE', currentLotId: next.id, version: { increment: 1 } }
        });
      } else {
        await tx.playerAuctionBatch.update({
          where: { id: batch.id },
          data: { status: 'COMPLETED', currentLotId: null, completedAt: now, version: { increment: 1 } }
        });
      }
      const text = lot.currentHighestBid?.leagueTeam
        ? this.formatter.pendingReview(lot.playerNameSnapshot, lot.currentHighestBid.leagueTeam.name, lot.currentPrice ?? lot.startingPrice)
        : this.formatter.noBid(lot.playerNameSnapshot);
      await tx.wechatOutboxMessage.create({
        data: {
          deviceId: batch.groupBinding.deviceId,
          targetType: 'GROUP',
          targetId: batch.groupBinding.wechatGroupId,
          businessKey: `auction:${lotId}:epoch:${epoch}:closed`,
          text,
          priority: RESULT_PRIORITY
        }
      });
      if (next && nextEpoch !== null) {
        await tx.wechatOutboxMessage.create({
          data: {
            deviceId: batch.groupBinding.deviceId,
            targetType: 'GROUP',
            targetId: batch.groupBinding.wechatGroupId,
            businessKey: `auction:${next.id}:epoch:${nextEpoch}:opened`,
            text: this.formatter.opening({
              displayOrder: next.displayOrder,
              playerName: next.playerNameSnapshot,
              playerSnapshot: next.playerSnapshot as Record<string, unknown>,
              startingPrice: next.startingPrice,
              minimumIncrement: next.minimumIncrement
            }),
            priority: FOLLOW_UP_PRIORITY
          }
        });
      } else {
        await tx.wechatOutboxMessage.create({
          data: {
            deviceId: batch.groupBinding.deviceId,
            targetType: 'GROUP',
            targetId: batch.groupBinding.wechatGroupId,
            businessKey: `auction:${batch.id}:completed`,
            text: this.formatter.completed(),
            priority: FOLLOW_UP_PRIORITY
          }
        });
      }
      return true;
    });
  }
}
