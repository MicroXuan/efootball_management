import { Inject, Injectable, Optional } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PesdataSyncService } from '../pesdata-sync/pesdata-sync.service.js';
import { PesdataPlayerChunkProcessor } from '../pesdata-sync/pesdata-player-chunk.processor.js';
import { PesdataTeamChunkProcessor } from '../pesdata-sync/pesdata-team-chunk.processor.js';
import { PesdataTeamSyncService } from '../pesdata-sync/pesdata-team-sync.service.js';
import { SYNC_RECONCILE_INTERVAL_MS } from './platform-data-sync.constants.js';

export { SYNC_LEASE_MS } from './platform-data-sync.constants.js';

@Injectable()
export class PlatformDataSyncRunner implements OnModuleInit, OnModuleDestroy {
  private readonly running = new Map<string, Promise<unknown>>();
  private reconcileTimer?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(PesdataSyncService) private readonly playerSync?: PesdataSyncService,
    @Optional() @Inject(PesdataTeamSyncService) private readonly teamSync?: PesdataTeamSyncService,
    @Optional() @Inject(PesdataPlayerChunkProcessor) private readonly playerChunks?: PesdataPlayerChunkProcessor,
    @Optional() @Inject(PesdataTeamChunkProcessor) private readonly teamChunks?: PesdataTeamChunkProcessor
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reconcileStaleRuns();
    const [players, teams] = await Promise.all([
      this.prisma.externalSyncRun.findMany({ where: { status: 'PENDING', activeLeaseKey: { not: null } }, select: { id: true } }),
      this.prisma.teamCatalogSyncRun.findMany({ where: { status: 'PENDING', activeLeaseKey: { not: null } }, select: { id: true } })
    ]);
    for (const { id } of players) this.schedulePlayer(id);
    for (const { id } of teams) this.scheduleTeam(id);
    this.reconcileTimer = setInterval(() => {
      void this.reconcileStaleRuns().catch(() => undefined);
    }, SYNC_RECONCILE_INTERVAL_MS);
    this.reconcileTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
  }

  schedulePlayer(runId: string): void {
    if (this.playerChunks) {
      this.schedule(
        `PLAYER_CARDS:${runId}`,
        () => this.playerChunks!.processNextChunk(runId),
        (outcome) => outcome.disposition === 'CONTINUE' && this.schedulePlayer(runId)
      );
      return;
    }
    if (!this.playerSync) throw new Error('PLAYER_SYNC_SERVICE_UNAVAILABLE');
    this.schedule(`PLAYER_CARDS:${runId}`, () => this.playerSync!.executePlatformRun(runId));
  }

  scheduleTeam(runId: string): void {
    if (this.teamChunks) {
      this.schedule(
        `TEAM_SHELLS:${runId}`,
        () => this.teamChunks!.processNextChunk(runId),
        (outcome) => outcome.disposition === 'CONTINUE' && this.scheduleTeam(runId)
      );
      return;
    }
    if (!this.teamSync) throw new Error('TEAM_SYNC_SERVICE_UNAVAILABLE');
    this.schedule(`TEAM_SHELLS:${runId}`, () => this.teamSync!.executePlatformRun(runId));
  }

  private schedule<T>(key: string, execute: () => Promise<T>, after?: (outcome: T) => void): void {
    if (this.running.has(key)) return;
    const task = Promise.resolve().then(execute);
    this.running.set(key, task);
    void task.then((outcome) => {
      this.running.delete(key);
      if (after) queueMicrotask(() => after(outcome));
    }, () => {
      this.running.delete(key);
    });
  }

  async reconcileStaleRuns(now = new Date()): Promise<{ players: number; teams: number }> {
    const stalePlayers: Prisma.ExternalSyncRunWhereInput = {
      status: { in: ['PENDING', 'RUNNING'] },
      activeLeaseKey: { not: null },
      leaseExpiresAt: { lt: now }
    };
    const staleTeams: Prisma.TeamCatalogSyncRunWhereInput = {
      status: { in: ['PENDING', 'RUNNING'] },
      activeLeaseKey: { not: null },
      leaseExpiresAt: { lt: now }
    };
    const recoverable = {
      status: 'PENDING' as const,
      leaseOwnerToken: null,
      leaseExpiresAt: null,
      heartbeatAt: now,
      currentPhase: 'QUEUED',
      errorCode: null,
      errorMessage: null
    };
    const [players, teams] = await this.prisma.$transaction([
      this.prisma.externalSyncRun.updateMany({ where: stalePlayers, data: { ...recoverable, finishedAt: null } }),
      this.prisma.teamCatalogSyncRun.updateMany({ where: staleTeams, data: { ...recoverable, completedAt: null } })
    ]);
    return { players: players.count, teams: teams.count };
  }
}
