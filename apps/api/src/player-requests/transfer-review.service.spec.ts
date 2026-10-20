/* eslint-disable @typescript-eslint/no-explicit-any -- focused transaction double */
import { jest } from '@jest/globals';
import { TransferReviewService } from './transfer-review.service.js';

const now = new Date('2026-10-21T12:00:00.000Z');
function harness() {
  const proposal: any = { id: 'proposal-1', leagueId: 'league-1', seasonId: 'season-1', ownershipId: 'ownership-1', sourceTeamId: 'team-1', targetTeamId: 'team-2', initiatorTeamId: 'team-1', counterpartyUserId: 'user-2', amountMinor: 15000, expectedOwnershipVersion: 4, status: 'PENDING_ADMIN', version: 2, reason: '协商转会', reviewReason: null, createdAt: now, reviewedAt: null, ownership: { id: 'ownership-1', status: 'ACTIVE', version: 4, leagueTeamId: 'team-1', footballPlayer: { nameZh: '瓦拉内' } }, sourceTeam: { name: '巴塞罗那', teamNumber: 4 }, targetTeam: { name: '阿贾克斯', teamNumber: 3 }, events: [] };
  const tx: any = { $queryRaw: jest.fn(async () => []), transferProposal: { findUnique: jest.fn(async () => proposal), updateMany: jest.fn(async ({ where, data }: any) => { if (proposal.status !== where.status || proposal.version !== where.version) return { count: 0 }; Object.assign(proposal, data, { version: proposal.version + 1 }); return { count: 1 }; }) }, transferProposalEvent: { create: jest.fn(async ({ data }: any) => ({ id: 'event-1', ...data })) } };
  const prisma: any = { transferProposal: { findMany: jest.fn(async () => [proposal]) } };
  const authorization: any = { requireLeagueManager: jest.fn(async () => undefined) };
  const receipts: any = { execute: jest.fn(async (_actor: string, _op: string, _key: string, work: (client: any) => Promise<any>) => work(tx)) };
  const roster: any = { transferWithClient: jest.fn(async () => ({ transaction: { id: 'transaction-1' } })) };
  const audit: any = { record: jest.fn(async () => undefined) };
  const service = new TransferReviewService(prisma, authorization, receipts, roster, audit);
  return { service, proposal, tx, roster, audit, authorization };
}

describe('TransferReviewService', () => {
  it('approves once in the same transaction using the frozen amount and version', async () => {
    const { service, proposal, tx, roster } = harness();
    const result = await service.review('admin-1', 'league-1', proposal.id, { decision: 'APPROVE', reason: '已核实', expectedVersion: 2 }, 'k1', now);
    expect(result).toMatchObject({ status: 'APPROVED', amountMinor: 15000 });
    expect(roster.transferWithClient).toHaveBeenCalledWith(tx, expect.objectContaining({ amountMinor: 15000, expectedVersion: 4, targetLeagueTeamId: 'team-2' }), 'admin-1', now);
    await expect(service.review('admin-2', 'league-1', proposal.id, { decision: 'APPROVE', reason: '重复', expectedVersion: 2 }, 'k2', now)).rejects.toMatchObject({ status: 409 });
    expect(roster.transferWithClient).toHaveBeenCalledTimes(1);
  });

  it('does not mark approved when the final roster check fails', async () => {
    const { service, proposal, roster, tx } = harness();
    roster.transferWithClient.mockRejectedValueOnce(new Error('window closed or cap exceeded'));
    await expect(service.review('admin-1', 'league-1', proposal.id, { decision: 'APPROVE', reason: '已核实', expectedVersion: 2 }, 'k1', now)).rejects.toThrow('window closed or cap exceeded');
    expect(tx.transferProposal.updateMany).not.toHaveBeenCalled();
    expect(proposal.status).toBe('PENDING_ADMIN');
  });
});
