import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { PlayerAuctionLockRepository } from './player-auction-lock.repository.js';
import { AUCTION_PAUSE_TIMEOUT_MS } from './player-auction-pause.js';

@Injectable()
export class PlayerAuctionPauseTimeoutService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PlayerAuctionPauseTimeoutService.name);
  private timer?: NodeJS.Timeout;
  private inFlight: Promise<void> | undefined;
  private stopped = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlayerAuctionLockRepository) private readonly locks: PlayerAuctionLockRepository
  ) {}

  onApplicationBootstrap(): void {
    this.schedule();
    this.timer = setInterval(() => this.schedule(), 5_000);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.inFlight;
  }

  private schedule(): void {
    if (this.stopped || this.inFlight) return;
    this.inFlight = this.cancelExpired().then(() => undefined)
      .catch((error: unknown) => this.logger.error('Auction pause timeout scan failed', error))
      .finally(() => { this.inFlight = undefined; });
  }

  async cancelExpired(now = new Date()): Promise<number> {
    const candidates = await this.prisma.playerAuctionBatch.findMany({
      where: { status: { in: ['PAUSED', 'RECOVERY_REQUIRED'] }, pausedAt: { lte: new Date(now.getTime() - AUCTION_PAUSE_TIMEOUT_MS) } },
      select: { id: true, leagueId: true, groupBindingId: true },
      orderBy: [{ pausedAt: 'asc' }, { id: 'asc' }],
      take: 100
    });
    let cancelled = 0;
    for (const candidate of candidates) {
      const changed = await this.prisma.$transaction(async (tx) => {
        await this.locks.lockLeague(tx, candidate.leagueId);
        if (candidate.groupBindingId) await this.locks.lockGroup(tx, candidate.groupBindingId);
        await this.locks.lockBatch(tx, candidate.id);
        const batch = await tx.playerAuctionBatch.findUnique({ where: { id: candidate.id } });
        if (!batch || !['PAUSED', 'RECOVERY_REQUIRED'].includes(batch.status) || !batch.pausedAt) return false;
        const databaseNow = await this.locks.now(tx);
        if (databaseNow.getTime() - batch.pausedAt.getTime() < AUCTION_PAUSE_TIMEOUT_MS) return false;
        await tx.playerAuctionLot.updateMany({
          where: { batchId: batch.id, status: { in: ['QUEUED', 'ACTIVE', 'PAUSED'] } },
          data: { status: 'VOID', deadlineAt: null, pausedRemainingMs: null, closedAt: databaseNow,
            deadlineEpoch: { increment: 1 }, version: { increment: 1 } }
        });
        await tx.playerAuctionBatch.update({
          where: { id: batch.id },
          data: { status: 'CANCELLED', currentLotId: null, cancelledAt: databaseNow, version: { increment: 1 } }
        });
        await tx.auditLog.create({ data: {
          leagueId: batch.leagueId, action: 'player-auction.pause-timeout', resourceType: 'PlayerAuctionBatch',
          resourceId: batch.id, reason: '连续暂停满1小时，自动取消未结束拍品',
          metadata: { previousStatus: batch.status, pausedAt: batch.pausedAt.toISOString() }
        } });
        return true;
      });
      if (changed) cancelled += 1;
    }
    return cancelled;
  }
}
