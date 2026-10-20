/* eslint-disable @typescript-eslint/no-explicit-any -- focused transaction double */
import { jest } from '@jest/globals';
import { TransferProposalService } from './transfer-proposal.service.js';

const now = new Date('2026-10-21T12:00:00.000Z');
const seasonId = '11111111-1111-4111-8111-111111111111';
const raw = { seasonId, initiatorTeamId: '44444444-4444-4444-8444-444444444444', ownershipId: '33333333-3333-4333-8333-333333333333', targetTeamId: '44444444-4444-4444-8444-444444444444', amountMinor: 15000, expectedOwnershipVersion: 3 };
function harness() {
  const sourceTeamId = '22222222-2222-4222-8222-222222222222';
  const ownership: any = { id: raw.ownershipId, leagueId: 'league-1', leagueTeamId: sourceTeamId, status: 'ACTIVE', version: 3, footballPlayer: { nameZh: '瓦拉内' }, leagueTeam: { id: sourceTeamId, name: '巴塞罗那', teamNumber: 4 } };
  const target: any = { id: raw.targetTeamId, leagueId: 'league-1', status: 'ACTIVE', name: '阿贾克斯', teamNumber: 3, seasonEntries: [{ status: 'APPROVED' }] };
  let proposal: any;
  const tx: any = { $queryRaw: jest.fn(async () => []), leaguePlayerOwnership: { findUnique: jest.fn(async () => ownership) }, leagueTeam: { findUnique: jest.fn(async () => target) }, transferProposal: {
    findFirst: jest.fn(async () => proposal?.status === 'PENDING_COUNTERPARTY' ? proposal : null),
    findUnique: jest.fn(async () => proposal),
    create: jest.fn(async ({ data }: any) => { proposal = { id: 'proposal-1', status: 'PENDING_COUNTERPARTY', version: 1, createdAt: now, reviewedAt: null, reviewReason: null, ...data, ownership, sourceTeam: ownership.leagueTeam, targetTeam: target, events: [] }; return proposal; }),
    updateMany: jest.fn(async ({ where, data }: any) => { if (proposal.version !== where.version || proposal.status !== where.status) return { count: 0 }; proposal = { ...proposal, ...data, version: proposal.version + 1 }; return { count: 1 }; })
  }, transferProposalEvent: { create: jest.fn(async () => ({})) } };
  const prisma: any = { transferProposal: { findMany: jest.fn(async () => proposal ? [proposal] : []), findUnique: jest.fn(async () => proposal) }, leaguePlayerOwnership: { findUnique: jest.fn(async () => ownership) } };
  const access: any = { requireOwnedTeam: jest.fn(async () => ({ leagueId: 'league-1', leagueTeamId: raw.initiatorTeamId })), requireParticipant: jest.fn(async () => ({ leagueId: 'league-1', leagueTeamId: sourceTeamId })) };
  const windows: any = { requireAllowedWithClient: jest.fn(async () => ({})), requireAllowed: jest.fn(async () => ({})) };
  const receipts: any = { execute: jest.fn(async (_actor: string, _op: string, _key: string, work: (client: any) => Promise<any>) => work(tx)) };
  const service = new TransferProposalService(prisma, access, windows, receipts);
  return { service, tx, ownership, target, access, windows, get proposal() { return proposal; } };
}

describe('TransferProposalService', () => {
  it('rejects a seller-initiated proposal so only the buying team can make an offer', async () => {
    const h = harness();
    await expect(h.service.submit('u1', { ...raw, initiatorTeamId: h.ownership.leagueTeamId }, 'seller-offer', now)).rejects.toMatchObject({ status: 403 });
    expect(h.tx.transferProposal.create).not.toHaveBeenCalled();
  });

  it('submits without moving ownership, then only the other team can confirm the fixed amount', async () => {
    const h = harness();
    await expect(h.service.submit('u1', { ...raw, targetTeamId: h.ownership.leagueTeamId }, 'k0', now)).rejects.toMatchObject({ status: 400 });
    const item = await h.service.submit('u1', raw, 'k1', now);
    expect(item).toMatchObject({ status: 'PENDING_COUNTERPARTY', amountMinor: 15000 });
    expect(h.ownership.leagueTeamId).not.toBe(raw.initiatorTeamId);
    await expect(h.service.submit('u1', raw, 'k2', now)).rejects.toMatchObject({ status: 409 });
    h.access.requireParticipant.mockResolvedValueOnce({ leagueTeamId: raw.initiatorTeamId });
    await expect(h.service.respond('u1', item.id, { decision: 'CONFIRM', expectedVersion: 1 }, 'k3', now)).rejects.toMatchObject({ status: 403 });
    const confirmed = await h.service.respond('u2', item.id, { decision: 'CONFIRM', expectedVersion: 1 }, 'k4', now);
    expect(confirmed).toMatchObject({ status: 'PENDING_ADMIN', amountMinor: 15000 });
    expect(h.tx.transferProposalEvent.create).toHaveBeenCalledTimes(2);
  });

  it('rejects stale ownership and closed window before proposal creation', async () => {
    const h = harness();
    await expect(h.service.submit('u1', { ...raw, expectedOwnershipVersion: 2 }, 'k1', now)).rejects.toMatchObject({ status: 409 });
    h.windows.requireAllowedWithClient.mockRejectedValueOnce(new Error('closed'));
    await expect(h.service.submit('u1', raw, 'k2', now)).rejects.toThrow('closed');
    expect(h.tx.transferProposal.create).not.toHaveBeenCalled();
  });
});
