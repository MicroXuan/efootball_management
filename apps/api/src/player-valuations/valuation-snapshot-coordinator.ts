import { Prisma } from '../generated/prisma/client.js';

export const valuationSnapshotInclude = {
  ownership: {
    include: {
      footballPlayer: true,
      currentPlayerCard: true
    }
  }
} satisfies Prisma.ValuationRosterSnapshotInclude;

export type ValuationRosterSnapshotRecord = Prisma.ValuationRosterSnapshotGetPayload<{
  include: typeof valuationSnapshotInclude;
}>;

export async function createValuationWindowSnapshot(
  tx: Prisma.TransactionClient,
  windowId: string,
  seasonId: string,
  leagueId: string,
  at: Date
): Promise<ValuationRosterSnapshotRecord[]> {
  const locked = await tx.valuationWindow.findUniqueOrThrow({
    where: { id: windowId },
    select: { id: true, snapshotInitializedAt: true }
  });
  const existing = await tx.valuationRosterSnapshot.findMany({
    where: { windowId },
    include: valuationSnapshotInclude,
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
    include: valuationSnapshotInclude,
    orderBy: [{ leagueTeamId: 'asc' }, { footballPlayerId: 'asc' }]
  });
}

export async function synchronizeSeasonValuationSnapshots(
  tx: Prisma.TransactionClient,
  seasonId: string,
  clock: () => Date = () => new Date()
): Promise<void> {
  await tx.$queryRaw(Prisma.sql`
    SELECT id FROM league_seasons WHERE id = ${seasonId} FOR UPDATE
  `);
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
    await createValuationWindowSnapshot(
      tx,
      window.id,
      window.seasonId,
      window.season.leagueId,
      at
    );
  }
}
