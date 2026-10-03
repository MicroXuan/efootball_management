import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { ValuationWorkspace } from '@efm/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { LeagueError } from '../leagues/league.errors.js';
import { ValuationWindowsService } from './valuation-windows.service.js';
import { valuationRange } from './valuation-calculator.js';

const snapshotInclude = {
  ownership: {
    include: {
      footballPlayer: true,
      currentPlayerCard: true
    }
  }
} satisfies Prisma.ValuationRosterSnapshotInclude;

type Snapshot = Prisma.ValuationRosterSnapshotGetPayload<{ include: typeof snapshotInclude }>;

@Injectable()
export class ValuationSnapshotsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ValuationWindowsService) private readonly windows: ValuationWindowsService
  ) {}

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
    const due = await this.prisma.valuationWindow.findMany({
      where: {
        ...(seasonId ? { seasonId } : {}),
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
    await tx.$queryRaw(Prisma.sql`
      SELECT id
      FROM valuation_windows
      WHERE season_id = ${seasonId}
        AND closed_at IS NULL
        AND ends_at > CURRENT_TIMESTAMP(3)
      ORDER BY starts_at ASC, id ASC
      FOR UPDATE
    `);
    const at = clock();
    const due = await tx.valuationWindow.findMany({
      where: {
        seasonId,
        startsAt: { lte: at },
        endsAt: { gt: at },
        closedAt: null,
        snapshotInitializedAt: null
      },
      select: {
        id: true,
        seasonId: true,
        season: { select: { leagueId: true } }
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }]
    });
    for (const window of due) {
      await this.createWindowSnapshotWithClient(
        tx,
        window.id,
        window.seasonId,
        window.season.leagueId,
        at
      );
    }
  }

  async ensureWindowSnapshot(windowId: string, at = new Date()): Promise<Snapshot[]> {
    const effective = await this.windows.getEffectiveRule(windowId, at);
    if (effective.window.state !== 'OPEN') {
      throw new LeagueError('VALUATION_WINDOW_NOT_OPEN', '身价窗口当前未开放', 409);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM valuation_windows WHERE id = ${windowId} FOR UPDATE`);
      return this.createWindowSnapshotWithClient(
        tx,
        windowId,
        effective.window.seasonId,
        effective.leagueId,
        at
      );
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  private async createWindowSnapshotWithClient(
    tx: Prisma.TransactionClient,
    windowId: string,
    seasonId: string,
    leagueId: string,
    at: Date
  ): Promise<Snapshot[]> {
    const locked = await tx.valuationWindow.findUniqueOrThrow({
      where: { id: windowId },
      select: { id: true, snapshotInitializedAt: true }
    });
    const existing = await tx.valuationRosterSnapshot.findMany({
      where: { windowId },
      include: snapshotInclude,
      orderBy: [{ leagueTeamId: 'asc' }, { footballPlayerId: 'asc' }]
    });
    if (locked.snapshotInitializedAt || existing.length > 0) return existing;

    const entries = await tx.seasonEntry.findMany({
      where: { seasonId, status: 'APPROVED' },
      select: { leagueTeamId: true }
    });
    const teamIds = entries.map((entry) => entry.leagueTeamId);
    const ownerships = teamIds.length
      ? await tx.leaguePlayerOwnership.findMany({
        where: { leagueTeamId: { in: teamIds }, status: 'ACTIVE' },
        include: {
          footballPlayer: true,
          currentPlayerCard: true
        },
        orderBy: [{ leagueTeamId: 'asc' }, { footballPlayerId: 'asc' }]
      })
      : [];
    const valuations = ownerships.length
      ? await tx.leaguePlayerValuation.findMany({
        where: {
          leagueId,
          footballPlayerId: { in: ownerships.map((ownership) => ownership.footballPlayerId) }
        },
        select: { footballPlayerId: true, currentValueMinor: true }
      })
      : [];
    const valueByPlayer = new Map(
      valuations.map((valuation) => [valuation.footballPlayerId, valuation.currentValueMinor])
    );
    if (ownerships.length) {
      await tx.valuationRosterSnapshot.createMany({
        data: ownerships.map((ownership) => ({
          windowId,
          leagueTeamId: ownership.leagueTeamId,
          ownershipId: ownership.id,
          footballPlayerId: ownership.footballPlayerId,
          baseValueMinor: valueByPlayer.get(ownership.footballPlayerId) ?? null
        })),
        skipDuplicates: true
      });
    }
    await tx.valuationWindow.update({
      where: { id: windowId },
      data: { snapshotInitializedAt: at }
    });
    return tx.valuationRosterSnapshot.findMany({
      where: { windowId },
      include: snapshotInclude,
      orderBy: [{ leagueTeamId: 'asc' }, { footballPlayerId: 'asc' }]
    });
  }

  async getWorkspace(userId: string, teamId: string, at = new Date()): Promise<ValuationWorkspace> {
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
