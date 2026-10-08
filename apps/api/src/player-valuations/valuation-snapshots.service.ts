import { Inject, Injectable, Optional, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { ValuationWorkspace } from '@efm/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { LeagueError } from '../leagues/league.errors.js';
import { ValuationWindowsService } from './valuation-windows.service.js';
import { valuationRange } from './valuation-calculator.js';
import {
  createValuationWindowSnapshot,
  synchronizeSeasonValuationSnapshots,
  type ValuationRosterSnapshotRecord
} from './valuation-snapshot-coordinator.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';

@Injectable()
export class ValuationSnapshotsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly visibility: LeagueVisibilityService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ValuationWindowsService) private readonly windows: ValuationWindowsService,
    @Optional() @Inject(LeagueVisibilityService) visibility?: LeagueVisibilityService
  ) {
    this.visibility = visibility ?? new LeagueVisibilityService(prisma);
  }

  onApplicationBootstrap() {
    void this.initializeDueWindows().catch(() => undefined);
    this.timer = setInterval(() => {
      void this.initializeDueWindows().catch(() => undefined);
    }, 1_000);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async initializeDueWindows(at = new Date(), seasonId?: string) {
    if (seasonId) await this.visibility.requireVisible({ type: 'SEASON', id: seasonId });
    const due = await this.prisma.valuationWindow.findMany({
      where: {
        ...(seasonId ? { seasonId } : {}),
        season: { league: { isDeleted: false } },
        startsAt: { lte: at },
        endsAt: { gt: at },
        closedAt: null,
        snapshotInitializedAt: null
      },
      select: { id: true },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }]
    });
    for (const window of due) await this.ensureWindowSnapshot(window.id, at);
  }

  async synchronizeSeasonBeforeRosterMutation(
    tx: Prisma.TransactionClient,
    seasonId: string,
    clock: () => Date = () => new Date()
  ): Promise<void> {
    await this.visibility.requireVisible({ type: 'SEASON', id: seasonId }, tx);
    await synchronizeSeasonValuationSnapshots(tx, seasonId, clock);
  }

  async ensureWindowSnapshot(windowId: string, at = new Date()): Promise<ValuationRosterSnapshotRecord[]> {
    await this.visibility.requireVisible({ type: 'VALUATION_WINDOW', id: windowId });
    const effective = await this.windows.getEffectiveRule(windowId, at);
    if (effective.window.state !== 'OPEN') {
      throw new LeagueError('VALUATION_WINDOW_NOT_OPEN', '身价窗口当前未开放', 409);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM valuation_windows WHERE id = ${windowId} FOR UPDATE`);
      return createValuationWindowSnapshot(
        tx,
        windowId,
        effective.window.seasonId,
        effective.leagueId,
        at
      );
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async getWorkspace(userId: string, teamId: string, at = new Date()): Promise<ValuationWorkspace> {
    await this.visibility.requireVisible({ type: 'TEAM', id: teamId });
    const team = await this.prisma.leagueTeam.findUnique({
      where: { id: teamId },
      select: { id: true, name: true, ownerUserId: true, leagueId: true }
    });
    if (!team) throw new LeagueError('VALUATION_TEAM_NOT_FOUND', '未找到球队', 404);
    if (team.ownerUserId !== userId) {
      throw new LeagueError('VALUATION_TEAM_OWNER_REQUIRED', '只有球队拥有者可以管理本队身价', 403);
    }
    const activeWindow = await this.prisma.valuationWindow.findFirst({
      where: {
        startsAt: { lte: at },
        endsAt: { gt: at },
        closedAt: null,
        season: { leagueId: team.leagueId }
      },
      orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
      select: { id: true, seasonId: true }
    });
    if (!activeWindow) {
      throw new LeagueError('VALUATION_WINDOW_NOT_OPEN', '当前没有开放的身价窗口', 409);
    }
    const entry = await this.prisma.seasonEntry.findFirst({
      where: {
        seasonId: activeWindow.seasonId,
        leagueTeamId: teamId,
        ownerUserId: userId,
        status: 'APPROVED'
      },
      select: { id: true }
    });
    if (!entry) {
      throw new LeagueError('VALUATION_SEASON_ENTRY_REQUIRED', '只有已报名并通过的球队可以进入身价管理', 403);
    }

    const effective = await this.windows.getEffectiveRule(activeWindow.id, at);
    const allSnapshots = await this.ensureWindowSnapshot(activeWindow.id, at);
    const snapshots = allSnapshots.filter((snapshot) => snapshot.leagueTeamId === teamId);
    const submission = await this.prisma.valuationSubmission.findFirst({
      where: { windowId: activeWindow.id, leagueTeamId: teamId },
      include: { items: true },
      orderBy: [{ attemptNumber: 'desc' }, { createdAt: 'desc' }]
    });
    const playerIds = snapshots.map((snapshot) => snapshot.footballPlayerId);
    const currentValuations = playerIds.length
      ? await this.prisma.leaguePlayerValuation.findMany({
        where: { leagueId: effective.leagueId, footballPlayerId: { in: playerIds } },
        select: { footballPlayerId: true, currentValueMinor: true }
      })
      : [];
    const currentValueByPlayer = new Map(
      currentValuations.map((valuation) => [valuation.footballPlayerId, valuation.currentValueMinor])
    );
    const draftBySnapshot = new Map(
      (submission?.items ?? []).map((item) => [item.snapshotId, item])
    );

    return {
      window: {
        id: effective.window.id,
        name: effective.window.name,
        state: effective.window.state,
        startsAt: effective.window.startsAt,
        endsAt: effective.window.endsAt,
        rule: {
          id: effective.rule.id,
          version: effective.rule.version,
          minimumValueMinor: effective.rule.minimumValueMinor,
          maximumValueMinor: effective.rule.maximumValueMinor,
          maximumIncreaseBps: effective.rule.maximumIncreaseBps,
          maximumDecreaseBps: effective.rule.maximumDecreaseBps
        }
      },
      team: { id: team.id, name: team.name },
      submission: submission ? {
        id: submission.id,
        windowId: submission.windowId,
        leagueTeamId: submission.leagueTeamId,
        ruleVersionId: submission.ruleVersionId,
        attemptNumber: submission.attemptNumber,
        status: submission.status,
        submittedAt: submission.submittedAt?.toISOString() ?? null,
        reviewedAt: submission.reviewedAt?.toISOString() ?? null,
        reviewReason: submission.reviewReason,
        version: submission.version
      } : null,
      players: snapshots.map((snapshot) => {
        const range = valuationRange(snapshot.baseValueMinor, effective.rule);
        const draft = draftBySnapshot.get(snapshot.id);
        const draftValueMinor = draft?.proposedValueMinor ?? null;
        return {
          snapshotId: snapshot.id,
          playerId: snapshot.footballPlayerId,
          playerName: snapshot.ownership.footballPlayer.nameZh
            ?? snapshot.ownership.footballPlayer.nameEn
            ?? snapshot.ownership.footballPlayer.shortName
            ?? '未命名球员',
          cardName: snapshot.ownership.currentPlayerCard.cardName,
          cardImageUrl: snapshot.ownership.currentPlayerCard.imageUrl,
          rosterStatus: snapshot.ownership.status,
          baseValueMinor: snapshot.baseValueMinor,
          currentValueMinor: currentValueByPlayer.get(snapshot.footballPlayerId) ?? null,
          minimumAllowedMinor: range.minimum,
          maximumAllowedMinor: range.maximum,
          draftValueMinor,
          exceedsRange: draftValueMinor !== null
            && (draftValueMinor < range.minimum || draftValueMinor > range.maximum)
        };
      })
    };
  }

}
