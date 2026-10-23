import { BadRequestException, ConflictException, Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { scheduledBusinessDate } from './player-catalog-reconciliation.rules.js';
import { SYNC_LEASE_MS } from '../platform-data-sync/platform-data-sync.constants.js';

export type PlayerCatalogScheduleInput = { enabled: boolean; timeZone: string; localTime: string };
export type PlayerCatalogScheduleView = PlayerCatalogScheduleInput & { lastTriggeredDate: string | null };

function assertSchedule(input: PlayerCatalogScheduleInput): void {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.localTime)) throw new BadRequestException('INVALID_LOCAL_TIME');
  try { new Intl.DateTimeFormat('en-US', { timeZone: input.timeZone }).format(new Date()); }
  catch { throw new BadRequestException('INVALID_TIME_ZONE'); }
}

function localTimeOf(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.hour}:${values.minute}`;
}

@Injectable()
export class PlayerCatalogScheduleService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Optional() @Inject(AuditLogService) private readonly audit?: AuditLogService
  ) {}

  async get(adminId: string): Promise<PlayerCatalogScheduleView> {
    await this.authorization.requirePlatformAdmin(adminId);
    const source = await this.prisma.dataSource.findUnique({ where: { code: 'pesdata' }, select: { id: true } });
    const schedule = source ? await this.prisma.playerCatalogSyncSchedule.findUnique({ where: { sourceId: source.id } }) : null;
    return schedule ? { enabled: schedule.enabled, timeZone: schedule.timeZone,
      localTime: schedule.localTime, lastTriggeredDate: schedule.lastTriggeredDate }
      : { enabled: false, timeZone: 'UTC', localTime: '03:00', lastTriggeredDate: null };
  }

  async update(adminId: string, input: PlayerCatalogScheduleInput): Promise<PlayerCatalogScheduleView> {
    await this.authorization.requirePlatformAdmin(adminId);
    assertSchedule(input);
    const source = await this.prisma.dataSource.findUnique({ where: { code: 'pesdata' } });
    if (!source?.isEnabled) throw new BadRequestException('PESDATA_SOURCE_UNAVAILABLE');
    const current = await this.prisma.playerCatalogSyncSchedule.findUnique({ where: { sourceId: source.id } });
    if (input.enabled && !current?.enabled) {
      const baseline = await this.prisma.externalSyncRun.findFirst({
        where: { sourceId: source.id, mode: 'RECONCILE', status: 'READY', scanTrusted: true },
        orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
        select: { id: true, sourceTotal: true, errorCode: true }
      });
      const active = await this.prisma.playerCard.count({
        where: { sourceId: source.id, status: 'ACTIVE', publishedAt: { not: null } }
      });
      const unresolved = baseline ? await this.prisma.playerCatalogReconciliationItem.count({
        where: { runId: baseline.id, changeType: { in: ['ADDED', 'UPDATED', 'REMOVAL_CONFIRMED', 'FAILED', 'REMOVAL_CANDIDATE'] },
          publishedAt: null }
      }) : 0;
      if (!baseline || baseline.sourceTotal === null || baseline.sourceTotal !== active
        || baseline.errorCode === 'REMOVAL_ANOMALY' || unresolved > 0) {
        throw new BadRequestException('PLAYER_CATALOG_BASELINE_REQUIRED');
      }
    }
    const schedule = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.playerCatalogSyncSchedule.upsert({
        where: { sourceId: source.id },
        update: { actorId: adminId, ...input },
        create: { sourceId: source.id, actorId: adminId, ...input }
      });
      if (this.audit) await this.audit.record(tx, {
        actorAdminId: adminId, action: 'UPDATE_PLAYER_CATALOG_SCHEDULE',
        resourceType: 'PlayerCatalogSyncSchedule', resourceId: source.id,
        metadata: input
      });
      return saved;
    });
    return { enabled: schedule.enabled, timeZone: schedule.timeZone,
      localTime: schedule.localTime, lastTriggeredDate: schedule.lastTriggeredDate };
  }

  async startManual(adminId: string, now = new Date()): Promise<{ runId: string; status: 'PENDING' }> {
    await this.authorization.requirePlatformAdmin(adminId);
    const source = await this.prisma.dataSource.findUnique({ where: { code: 'pesdata' } });
    if (!source?.isEnabled) throw new BadRequestException('PESDATA_SOURCE_UNAVAILABLE');
    const schedule = await this.prisma.playerCatalogSyncSchedule.findUnique({ where: { sourceId: source.id } });
    const day = scheduledBusinessDate(now, schedule?.timeZone ?? 'UTC');
    try {
      const run = await this.prisma.externalSyncRun.create({ data: {
        sourceId: source.id, actorId: adminId, mode: 'RECONCILE', status: 'PENDING',
        activeLeaseKey: 'pesdata', currentPhase: 'SCAN_PASS_1', chunkSize: 100,
        businessDate: new Date(`${day}T00:00:00.000Z`),
        leaseExpiresAt: new Date(now.getTime() + SYNC_LEASE_MS), heartbeatAt: now
      } });
      return { runId: run.id, status: 'PENDING' };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('PESDATA_SYNC_CONFLICT');
      }
      throw error;
    }
  }

  async tick(now = new Date()): Promise<string[]> {
    const schedules = await this.prisma.playerCatalogSyncSchedule.findMany({ where: { enabled: true } });
    const created: string[] = [];
    for (const schedule of schedules) {
      const source = await this.prisma.dataSource.findUnique({
        where: { id: schedule.sourceId }, select: { isEnabled: true }
      });
      if (!source?.isEnabled) continue;
      const day = scheduledBusinessDate(now, schedule.timeZone);
      if (localTimeOf(now, schedule.timeZone) < schedule.localTime) continue;
      const scheduleKey = `pesdata:${day}`;
      if (await this.prisma.externalSyncRun.findUnique({ where: { scheduleKey }, select: { id: true } })) continue;
      try {
        const run = await this.prisma.$transaction(async (tx) => {
          const newRun = await tx.externalSyncRun.create({ data: {
            sourceId: schedule.sourceId, actorId: schedule.actorId, mode: 'RECONCILE',
            status: 'PENDING', activeLeaseKey: 'pesdata', currentPhase: 'SCAN_PASS_1', chunkSize: 100,
            scheduleKey, businessDate: new Date(`${day}T00:00:00.000Z`),
            leaseExpiresAt: new Date(now.getTime() + SYNC_LEASE_MS), heartbeatAt: now
          } });
          await tx.playerCatalogSyncSchedule.update({
            where: { sourceId: schedule.sourceId }, data: { lastTriggeredDate: day }
          });
          return newRun;
        });
        created.push(run.id);
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      }
    }
    return created;
  }
}
