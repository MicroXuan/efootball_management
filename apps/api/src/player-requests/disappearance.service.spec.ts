/* eslint-disable @typescript-eslint/no-explicit-any -- focused transaction double */
import { jest } from '@jest/globals';
import { DisappearanceService } from './disappearance.service.js';

const now = new Date('2026-10-20T12:00:00.000Z');
const seasonId = '11111111-1111-4111-8111-111111111111';
function harness() {
  const ownership = { id: 'ownership-1', leagueId: 'league-1', leagueTeamId: 'team-1', footballPlayerId: 'player-1', status: 'ACTIVE', version: 4, salaryMinor: 200 };
  const requests: any[] = [];
  const tx: any = {
    $queryRaw: jest.fn(async () => []),
    leaguePlayerOwnership: { findUnique: jest.fn(async () => ownership), update: jest.fn() },
    disappearanceRequest: {
      findFirst: jest.fn(async () => requests.find((item) => item.status === 'PENDING') ?? null),
      create: jest.fn(async ({ data }: any) => { const item = { id: 'request-1', status: 'PENDING', version: 1, createdAt: now, reviewedAt: null, ...data }; requests.push(item); return item; })
    },
    disappearanceRequestEvent: { create: jest.fn(async () => ({})) }
  };
  const prisma: any = { disappearanceRequest: { findMany: jest.fn(async () => requests) } };
  const access: any = { requireOwnedTeam: jest.fn(async () => ({ leagueId: 'league-1', leagueTeamId: 'team-1', seasonId })), requireParticipant: jest.fn() };
  const receipts: any = { execute: jest.fn(async (_actor: string, _op: string, _key: string, work: (client: any) => Promise<any>) => work(tx)) };
  const service = new DisappearanceService(prisma, access, receipts);
  return { service, tx, ownership, requests, access };
}

describe('DisappearanceService', () => {
  it('requires active owner and current ownership version', async () => {
    const { service, tx, access } = harness();
    access.requireOwnedTeam.mockRejectedValueOnce(new Error('not owner'));
    await expect(service.submit('other-user', 'team-1', 'ownership-1', { seasonId, reason: '离队', expectedOwnershipVersion: 4 }, 'k1', now)).rejects.toThrow('not owner');
    tx.leaguePlayerOwnership.findUnique.mockResolvedValueOnce({ id: 'ownership-1', leagueId: 'league-1', leagueTeamId: 'team-1', status: 'DISAPPEARED', version: 4 });
    await expect(service.submit('user-1', 'team-1', 'ownership-1', { seasonId, reason: '离队', expectedOwnershipVersion: 4 }, 'k2', now)).rejects.toMatchObject({ status: 409 });
    await expect(service.submit('user-1', 'team-1', 'ownership-1', { seasonId, reason: '离队', expectedOwnershipVersion: 3 }, 'k3', now)).rejects.toMatchObject({ status: 409 });
  });

  it('rejects blank reason and duplicate pending request without changing the roster or salary', async () => {
    const { service, tx, ownership, requests } = harness();
    await expect(service.submit('user-1', 'team-1', 'ownership-1', { seasonId, reason: ' ', expectedOwnershipVersion: 4 }, 'k1', now)).rejects.toBeDefined();
    const submitted = await service.submit('user-1', 'team-1', 'ownership-1', { seasonId, reason: '退役', expectedOwnershipVersion: 4 }, 'k2', now);
    expect(submitted).toMatchObject({ status: 'PENDING', reason: '退役', ownershipId: 'ownership-1' });
    expect(ownership).toMatchObject({ status: 'ACTIVE', salaryMinor: 200 });
    expect(tx.leaguePlayerOwnership.update).not.toHaveBeenCalled();
    expect(tx.disappearanceRequestEvent.create).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
    await expect(service.submit('user-1', 'team-1', 'ownership-1', { seasonId, reason: '再次申请', expectedOwnershipVersion: 4 }, 'k3', now)).rejects.toMatchObject({ status: 409 });
  });
});
