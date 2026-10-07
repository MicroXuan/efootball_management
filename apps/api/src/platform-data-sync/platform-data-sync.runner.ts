import { Inject, Injectable, Optional } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PesdataSyncService } from '../pesdata-sync/pesdata-sync.service.js';
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
    @Optional() @Inject(PesdataTeamSyncService) private readonly teamSync?: PesdataTeamSyncService
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reconcileStaleRuns();
    this.reconcileTimer = setInterval(() => {
      void this.reconcileStaleRuns().catch(() => undefined);
    }, SYNC_RECONCILE_INTERVAL_MS);
    this.reconcileTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
  }

  schedulePlayer(runId: string): void {
    if (!this.playerSync) throw new Error('PLAYER_SYNC_SERVICE_UNAVAILABLE');
    this.schedule(`PLAYER_CARDS:${runId}`, () => this.playerSync!.executePlatformRun(runId));
  }

  scheduleTeam(runId: string): void {
    if (!this.teamSync) throw new Error('TEAM_SYNC_SERVICE_UNAVAILABLE');
    this.schedule(`TEAM_SHELLS:${runId}`, () => this.teamSync!.executePlatformRun(runId));
  }

  private schedule(key: string, execute: () => Promise<unknown>): void {
    if (this.running.has(key)) return;
    const task = Promise.resolve().then(execute);
    this.running.set(key, task);
    void task.catch(() => undefined).finally(() => this.running.delete(key));
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
      this.prisma.externalSyncRun.updateMany({ where: stalePlayers, data: { ...interrupted, finishedAt: now } }),
      this.prisma.teamCatalogSyncRun.updateMany({ where: staleTeams, data: { ...interrupted, completedAt: now } })
    ]);
    return { players: players.count, teams: teams.count };
  }
}
