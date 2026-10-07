import { Inject, Injectable, Optional } from '@nestjs/common';
import type { BatchMutationResult } from '@efm/contracts';
import { Prisma } from '../generated/prisma/client.js';
import type { TeamCatalogSyncMode } from '../generated/prisma/enums.js';
import { PrismaService } from '../database/prisma.service.js';
import { PesdataClient, PesdataClientError } from './pesdata-client.js';
import { PesdataCrestLoader } from './pesdata-crest-loader.js';
import { pesdataValueChecksum } from './pesdata-mapper.js';
import { mapPesdataTeam } from './pesdata-team-mapper.js';
import { SYNC_LEASE_MS } from '../platform-data-sync/platform-data-sync.constants.js';

export const PESDATA_TEAM_SYNC_OPTIONS = Symbol('PESDATA_TEAM_SYNC_OPTIONS');
type Options = { pageSize?: number };
export type TeamSyncMode = 'sample' | 'full' | 'incremental';
export type TeamSyncResult = {
  runId: string;
  status: 'READY' | 'FAILED';
  scannedCount: number;
  addedCount: number;
  updatedCount: number;
  missingCount: number;
  failedCount: number;
  skippedCount: number;
};

export class PesdataTeamSyncError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'PesdataTeamSyncError'; }
}

function databaseMode(mode: TeamSyncMode): TeamCatalogSyncMode {
  return mode.toUpperCase() as TeamCatalogSyncMode;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

@Injectable()
export class PesdataTeamSyncService {
  private readonly pageSize: number;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PesdataClient) private readonly client: PesdataClient,
    @Inject(PesdataCrestLoader) private readonly crestLoader: PesdataCrestLoader,
    @Optional() @Inject(PESDATA_TEAM_SYNC_OPTIONS) options: Options = {}
  ) { this.pageSize = options.pageSize ?? 100; }

  async createPlatformRun(
    actorAdminId: string,
    input: { mode: TeamSyncMode; limit?: number }
  ): Promise<{ runId: string; status: 'PENDING' }> {
    const limit = input.mode === 'sample' ? input.limit ?? 2 : undefined;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 5_000)) {
      throw new PesdataTeamSyncError('PESDATA_TEAM_LIMIT_INVALID', 'Team synchronization limit is invalid');
    }
    const now = new Date();
    try {
      const run = await this.prisma.teamCatalogSyncRun.create({ data: {
        actorAdminId,
        mode: databaseMode(input.mode),
        status: 'PENDING',
        activeLeaseKey: 'pesdata-team-catalog',
        requestedLimit: limit ?? null,
        currentPhase: 'QUEUED',
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + SYNC_LEASE_MS)
      } });
      return { runId: run.id, status: 'PENDING' };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new PesdataTeamSyncError('PESDATA_TEAM_SYNC_CONFLICT', 'A team catalog synchronization is already running');
      }
      throw error;
    }
  }

  async resumePlatformRun(
    _actorAdminId: string,
    runId: string
  ): Promise<{ runId: string; status: 'PENDING' }> {
    const run = await this.prisma.teamCatalogSyncRun.findUnique({ where: { id: runId } });
    if (!run) throw new PesdataTeamSyncError('PESDATA_TEAM_RUN_NOT_FOUND', 'Team synchronization run was not found');
    if (run.activeLeaseKey) throw new PesdataTeamSyncError('PESDATA_TEAM_SYNC_CONFLICT', 'This team synchronization run is active');
    const now = new Date();
    try {
      await this.prisma.teamCatalogSyncRun.update({ where: { id: runId }, data: {
        status: 'PENDING',
        activeLeaseKey: 'pesdata-team-catalog',
        currentPhase: 'QUEUED',
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + SYNC_LEASE_MS),
        errorCode: null,
        errorMessage: null,
        completedAt: null
      } });
      return { runId, status: 'PENDING' };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new PesdataTeamSyncError('PESDATA_TEAM_SYNC_CONFLICT', 'A team catalog synchronization is already running');
      }
      throw error;
    }
  }

  async executePlatformRun(runId: string): Promise<TeamSyncResult> {
    const run = await this.prisma.teamCatalogSyncRun.findUnique({ where: { id: runId } });
    if (!run) throw new PesdataTeamSyncError('PESDATA_TEAM_RUN_NOT_FOUND', 'Team synchronization run was not found');
    if (run.status === 'READY') return this.result(run, 0);
    if (run.status !== 'PENDING' || run.activeLeaseKey !== 'pesdata-team-catalog') {
      throw new PesdataTeamSyncError('PESDATA_TEAM_SYNC_CONFLICT', 'This team synchronization run is not queued');
    }
    const now = new Date();
    await this.prisma.teamCatalogSyncRun.update({ where: { id: runId }, data: {
      status: 'RUNNING',
      currentPhase: 'FETCHING',
      startedAt: run.startedAt ?? now,
      heartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + SYNC_LEASE_MS)
    } });
    try {
      return await this.execute(
        runId,
        run.mode === 'SAMPLE' ? 'sample' : run.mode === 'FULL' ? 'full' : 'incremental',
        run.requestedLimit ?? undefined,
        run.currentOffset
      );
    } catch (error) {
      await this.fail(runId, error);
      throw error;
    }
  }

  async start(actorAdminId: string, input: { mode: TeamSyncMode; limit?: number }): Promise<TeamSyncResult> {
    const limit = input.mode === 'sample' ? input.limit ?? 2 : undefined;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 5_000)) {
      throw new PesdataTeamSyncError('PESDATA_TEAM_LIMIT_INVALID', 'Team synchronization limit is invalid');
    }
    let run;
    try {
      run = await this.prisma.teamCatalogSyncRun.create({ data: {
        actorAdminId, mode: databaseMode(input.mode), status: 'RUNNING', activeLeaseKey: 'pesdata-team-catalog',
        requestedLimit: limit ?? null, startedAt: new Date(), currentPhase: 'FETCHING',
        heartbeatAt: new Date(), leaseExpiresAt: new Date(Date.now() + SYNC_LEASE_MS)
      } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new PesdataTeamSyncError('PESDATA_TEAM_SYNC_CONFLICT', 'A team catalog synchronization is already running');
      }
      throw error;
    }
    try {
      return await this.execute(run.id, input.mode, limit, 0);
    } catch (error) {
      await this.fail(run.id, error);
      throw error;
    }
  }

  async resume(actorAdminId: string, runId: string): Promise<TeamSyncResult> {
    const run = await this.prisma.teamCatalogSyncRun.findUnique({ where: { id: runId } });
    if (!run || run.actorAdminId !== actorAdminId) throw new PesdataTeamSyncError('PESDATA_TEAM_RUN_NOT_FOUND', 'Team synchronization run was not found');
    if (run.status === 'READY') return this.result(run, run.scannedCount - run.addedCount - run.updatedCount - run.failedCount);
    if (run.activeLeaseKey) throw new PesdataTeamSyncError('PESDATA_TEAM_SYNC_CONFLICT', 'This team synchronization run is active');
    await this.prisma.teamCatalogSyncRun.update({ where: { id: runId }, data: {
      status: 'RUNNING', activeLeaseKey: 'pesdata-team-catalog', errorCode: null, errorMessage: null, completedAt: null,
      currentPhase: 'FETCHING', heartbeatAt: new Date(), leaseExpiresAt: new Date(Date.now() + SYNC_LEASE_MS)
    } });
    try {
      return await this.execute(runId, run.mode === 'SAMPLE' ? 'sample' : run.mode === 'FULL' ? 'full' : 'incremental', run.requestedLimit ?? undefined, run.currentOffset);
    } catch (error) {
      await this.fail(runId, error);
      throw error;
    }
  }

  private async execute(runId: string, mode: TeamSyncMode, limit?: number, startingOffset = 0): Promise<TeamSyncResult> {
    const priorItems = await this.prisma.teamCatalogSyncItem.findMany({ where: { runId } });
    const completed = new Set(priorItems.filter(({ reviewStatus }) => reviewStatus !== 'FAILED').map(({ sourceExternalId }) => sourceExternalId));
    let offset = startingOffset;
    let scannedCount = completed.size;
    let addedCount = priorItems.filter(({ changeType }) => changeType === 'ADDED').length;
    let updatedCount = priorItems.filter(({ changeType }) => changeType === 'UPDATED').length;
    let failedCount = priorItems.filter(({ reviewStatus }) => reviewStatus === 'FAILED').length;
    let skippedCount = 0;
    const seen = new Set(completed);

    while (limit === undefined || scannedCount < limit) {
      const size = limit === undefined ? this.pageSize : Math.min(this.pageSize, limit - scannedCount);
      const page = await this.client.listTeams({ start: offset, limit: size, order: 'ASC' });
      if (!page.list.length) break;
      const sorted = [...page.list].sort((left, right) => left.teamId.localeCompare(right.teamId, undefined, { numeric: true }));
      for (const summary of sorted.slice(0, size)) {
        const externalId = summary.teamId;
        seen.add(externalId);
        if (completed.has(externalId)) { skippedCount += 1; continue; }
        scannedCount += 1;
        const summaryChecksum = pesdataValueChecksum(summary);
        try {
          const detail = await this.client.getTeamDetail(externalId);
          let candidate = mapPesdataTeam({
            ...detail,
            leagueId: detail.leagueId ?? summary.leagueId,
            leagueName: detail.leagueName ?? summary.leagueName
          });
          if (candidate.remoteLogoUrl) candidate = { ...candidate, ...(await this.crestLoader.load(candidate)) };
          const detailChecksum = pesdataValueChecksum(candidate);
          const current = await this.prisma.teamCatalogItem.findUnique({
            where: { sourceType_sourceExternalId: { sourceType: 'PESDATA', sourceExternalId: externalId } }
          });
          if (current?.sourceChecksum === detailChecksum && mode === 'incremental') {
            skippedCount += 1;
            completed.add(externalId);
            continue;
          }
          const changeType = current ? 'UPDATED' : 'ADDED';
          await this.prisma.teamCatalogSyncItem.upsert({
            where: { runId_sourceExternalId: { runId, sourceExternalId: externalId } },
            update: { summaryChecksum, detailChecksum, changeType, reviewStatus: 'PENDING', currentCatalogItemId: current?.id ?? null, candidateJson: json(candidate), rawDetail: json(detail), attempts: { increment: 1 }, errorCode: null, errorMessage: null },
            create: { runId, sourceExternalId: externalId, summaryChecksum, detailChecksum, changeType, currentCatalogItemId: current?.id ?? null, candidateJson: json(candidate), rawDetail: json(detail), attempts: 1 }
          });
          if (current) updatedCount += 1; else addedCount += 1;
          completed.add(externalId);
        } catch (error) {
          if (error instanceof PesdataClientError && error.code === 'PESDATA_PROTOCOL_ERROR') throw error;
          failedCount += 1;
          await this.prisma.teamCatalogSyncItem.upsert({
            where: { runId_sourceExternalId: { runId, sourceExternalId: externalId } },
            update: { summaryChecksum, reviewStatus: 'FAILED', attempts: { increment: 1 }, errorCode: this.code(error), errorMessage: this.message(error) },
            create: { runId, sourceExternalId: externalId, summaryChecksum, changeType: 'UPDATED', reviewStatus: 'FAILED', attempts: 1, errorCode: this.code(error), errorMessage: this.message(error) }
          });
        }
      }
      offset += page.list.length;
      const heartbeatAt = new Date();
      await this.prisma.teamCatalogSyncRun.update({ where: { id: runId }, data: {
        currentOffset: offset, scannedCount, addedCount, updatedCount, failedCount,
        currentPhase: 'FETCHING', heartbeatAt, leaseExpiresAt: new Date(heartbeatAt.getTime() + SYNC_LEASE_MS)
      } });
      if (page.list.length < size) break;
    }

    let missingCount = 0;
    if (mode === 'full') {
      const missing = await this.prisma.teamCatalogItem.findMany({ where: { sourceType: 'PESDATA', sourceExternalId: { notIn: [...seen] } } });
      for (const item of missing) {
        if (!item.sourceExternalId) continue;
        await this.prisma.teamCatalogSyncItem.upsert({
          where: { runId_sourceExternalId: { runId, sourceExternalId: item.sourceExternalId } },
          update: { changeType: 'SOURCE_MISSING', currentCatalogItemId: item.id, reviewStatus: 'PENDING' },
          create: { runId, sourceExternalId: item.sourceExternalId, summaryChecksum: item.sourceChecksum ?? pesdataValueChecksum(item.sourceExternalId), changeType: 'SOURCE_MISSING', currentCatalogItemId: item.id }
        });
        missingCount += 1;
      }
    }
    const run = await this.prisma.teamCatalogSyncRun.update({ where: { id: runId }, data: {
      status: 'READY', activeLeaseKey: null, leaseExpiresAt: null, currentPhase: 'READY', heartbeatAt: new Date(),
      scannedCount, addedCount, updatedCount, missingCount, failedCount, completedAt: new Date(), currentOffset: offset
    } });
    return this.result(run, skippedCount);
  }

  private result(run: { id: string; status: string; scannedCount: number; addedCount: number; updatedCount: number; missingCount: number; failedCount: number }, skippedCount: number): TeamSyncResult {
    return { runId: run.id, status: run.status as 'READY' | 'FAILED', scannedCount: run.scannedCount, addedCount: run.addedCount, updatedCount: run.updatedCount, missingCount: run.missingCount, failedCount: run.failedCount, skippedCount };
  }

  async retryPlatformItems(_actorAdminId: string, itemIds: string[]): Promise<BatchMutationResult> {
    const succeededIds: string[] = [];
    const failed: BatchMutationResult['failed'] = [];
    for (const itemId of itemIds) {
      try {
        const item = await this.prisma.teamCatalogSyncItem.findUnique({
          where: { id: itemId },
          include: { run: true }
        });
        if (!item) throw new PesdataTeamSyncError('TEAM_SYNC_ITEM_NOT_FOUND', 'Team sync item was not found');
        if (item.reviewStatus !== 'FAILED') throw new PesdataTeamSyncError('TEAM_SYNC_ITEM_NOT_FAILED', 'Only failed team sync items can be retried');
        if (item.run.activeLeaseKey) throw new PesdataTeamSyncError('PESDATA_TEAM_SYNC_CONFLICT', 'The parent run is active');
        const detail = await this.client.getTeamDetail(item.sourceExternalId);
        let candidate = mapPesdataTeam(detail);
        if (candidate.remoteLogoUrl) candidate = { ...candidate, ...(await this.crestLoader.load(candidate)) };
        const current = await this.prisma.teamCatalogItem.findUnique({
          where: { sourceType_sourceExternalId: { sourceType: 'PESDATA', sourceExternalId: item.sourceExternalId } }
        });
        await this.prisma.teamCatalogSyncItem.update({ where: { id: item.id }, data: {
          detailChecksum: pesdataValueChecksum(candidate),
          changeType: current ? 'UPDATED' : 'ADDED',
          reviewStatus: 'PENDING',
          currentCatalogItemId: current?.id ?? null,
          candidateJson: json(candidate),
          rawDetail: json(detail),
          attempts: { increment: 1 },
          errorCode: null,
          errorMessage: null
        } });
        succeededIds.push(itemId);
      } catch (error) {
        failed.push({ id: itemId, code: this.code(error), message: this.message(error) });
      }
    }
    return { requestedCount: itemIds.length, succeededIds, failed };
  }

  private async fail(runId: string, error: unknown) {
    await this.prisma.teamCatalogSyncRun.update({ where: { id: runId }, data: {
      status: 'FAILED', activeLeaseKey: null, leaseExpiresAt: null, currentPhase: 'FAILED', heartbeatAt: new Date(),
      errorCode: this.code(error), errorMessage: this.message(error), completedAt: new Date()
    } });
  }
  private code(error: unknown) { return error && typeof error === 'object' && 'code' in error ? String(error.code).slice(0, 128) : 'PESDATA_TEAM_ITEM_FAILED'; }
  private message(error: unknown) { return (error instanceof Error ? error.message : String(error)).slice(0, 512); }
}
