import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

export const SYNC_LEASE_MS = 60_000;

@Injectable()
export class PlatformDataSyncRunner {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async reconcileStaleRuns(now = new Date()): Promise<{ players: number; teams: number }> {
    const stale = {
      status: { in: ['PENDING', 'RUNNING'] as const },
      activeLeaseKey: { not: null },
      leaseExpiresAt: { lt: now }
    };
    const interrupted = {
      status: 'FAILED' as const,
      activeLeaseKey: null,
      leaseExpiresAt: null,
      heartbeatAt: now,
      currentPhase: 'INTERRUPTED',
      errorCode: 'PROCESS_INTERRUPTED',
      errorMessage: 'Synchronization process was interrupted and can be resumed'
    };
    const [players, teams] = await this.prisma.$transaction([
      this.prisma.externalSyncRun.updateMany({ where: stale, data: { ...interrupted, finishedAt: now } }),
      this.prisma.teamCatalogSyncRun.updateMany({ where: stale, data: { ...interrupted, completedAt: now } })
    ]);
    return { players: players.count, teams: teams.count };
  }
}
