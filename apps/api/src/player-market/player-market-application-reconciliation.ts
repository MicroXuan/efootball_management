import type { Prisma } from '../generated/prisma/client.js';

/**
 * Expires active applications from transfer windows that have already closed.
 *
 * Caller contract: acquire the player-market locks in the shared order
 * season -> player/ownership -> sorted teams -> sorted applications first.
 */
export async function expireClosedPlayerApplications(
  tx: Prisma.TransactionClient,
  input: { leagueId: string; seasonId: string; footballPlayerId: string; at: Date; excludeApplicationId?: string }
): Promise<number> {
  const stale = await tx.playerAcquisitionApplication.findMany({
    where: {
      leagueId: input.leagueId,
      seasonId: input.seasonId,
      footballPlayerId: input.footballPlayerId,
      ...(input.excludeApplicationId ? { id: { not: input.excludeApplicationId } } : {}),
      status: { in: ['PENDING', 'REQUOTE_REQUIRED'] },
      transferWindow: { endsAt: { lte: input.at } }
    },
    select: { id: true, status: true, amountMinor: true },
    orderBy: { id: 'asc' }
  });
  for (const application of stale) {
    await tx.playerAcquisitionApplication.update({
      where: { id: application.id },
      data: {
        status: 'EXPIRED', reviewedAt: input.at, reviewReason: 'TRANSFER_WINDOW_CLOSED',
        version: { increment: 1 }
      }
    });
    await tx.playerAcquisitionApplicationEvent.create({ data: {
      applicationId: application.id,
      type: 'EXPIRED',
      fromStatus: application.status,
      toStatus: 'EXPIRED',
      fromAmountMinor: application.amountMinor,
      toAmountMinor: application.amountMinor,
      actorUserId: null,
      actorAdminId: null,
      reason: 'TRANSFER_WINDOW_CLOSED'
    } });
  }
  return stale.length;
}
