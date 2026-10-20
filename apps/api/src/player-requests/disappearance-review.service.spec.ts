/* eslint-disable @typescript-eslint/no-explicit-any -- focused transaction double */
import { jest } from '@jest/globals';
import { DisappearanceReviewService } from './disappearance-review.service.js';

const now = new Date('2026-10-21T12:00:00.000Z');
function harness() {
  const request: any = { id: 'request-1', leagueId: 'league-1', seasonId: 'season-1', ownershipId: 'ownership-1', requesterTeamId: 'team-1', requesterUserId: 'user-1', expectedOwnershipVersion: 4, status: 'PENDING', reason: '游戏移除', reviewReason: null, reviewedByAdminId: null, reviewedAt: null, version: 1, createdAt: now,
    ownership: { id: 'ownership-1', leagueId: 'league-1', leagueTeamId: 'team-1', status: 'ACTIVE', version: 4, footballPlayer: { nameZh: '瓦拉内', nameEn: null } },
    requesterTeam: { name: '阿哈尔', teamNumber: 1 }, events: [] };
  const tx: any = {
    $queryRaw: jest.fn(async () => []),
    disappearanceRequest: {
      findUnique: jest.fn(async () => request),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (request.version !== where.version || request.status !== where.status) return { count: 0 };
        Object.assign(request, data, { version: request.version + 1 });
        return { count: 1 };
      })
    },
    disappearanceRequestEvent: { create: jest.fn(async ({ data }: any) => ({ id: 'event-2', ...data })) }
  };
  const prisma: any = { disappearanceRequest: { findMany: jest.fn(async () => [request]) } };
  const authorization: any = { requireLeagueManager: jest.fn(async () => undefined) };
  const receipts: any = { execute: jest.fn(async (_actor: string, _op: string, _key: string, work: (client: any) => Promise<any>) => work(tx)) };
  const roster: any = { updateLifecycleStatusWithClient: jest.fn(async () => { request.ownership.status = 'DISAPPEARED'; request.ownership.version += 1; }) };
  const audit: any = { record: jest.fn(async () => undefined) };
  const service = new DisappearanceReviewService(prisma, authorization, receipts, roster, audit);
  return { service, request, tx, authorization, roster, audit };
}

describe('DisappearanceReviewService', () => {
  it('approves once using the existing roster lifecycle core and records one review', async () => {
    const { service, request, roster, tx, audit } = harness();
    const result = await service.review('admin-1', 'league-1', request.id, { decision: 'APPROVE', reason: '已核实', expectedVersion: 1 }, 'k1', now);
    expect(result).toMatchObject({ status: 'APPROVED', reviewReason: '已核实' });
    expect(request.ownership.status).toBe('DISAPPEARED');
    expect(roster.updateLifecycleStatusWithClient).toHaveBeenCalledTimes(1);
    expect(tx.disappearanceRequestEvent.create).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(1);
    await expect(service.review('admin-2', 'league-1', request.id, { decision: 'APPROVE', reason: '重复', expectedVersion: 1 }, 'k2', now)).rejects.toMatchObject({ status: 409 });
    expect(roster.updateLifecycleStatusWithClient).toHaveBeenCalledTimes(1);
  });

  it('rejects without changing ownership and denies a different league manager', async () => {
    const { service, request, roster, authorization } = harness();
    authorization.requireLeagueManager.mockRejectedValueOnce(new Error('forbidden'));
    await expect(service.review('other-admin', 'league-1', request.id, { decision: 'REJECT', reason: '不符合', expectedVersion: 1 }, 'k1', now)).rejects.toThrow('forbidden');
    const result = await service.review('admin-1', 'league-1', request.id, { decision: 'REJECT', reason: '不符合', expectedVersion: 1 }, 'k2', now);
    expect(result.status).toBe('REJECTED');
    expect(roster.updateLifecycleStatusWithClient).not.toHaveBeenCalled();
    expect(request.ownership.status).toBe('ACTIVE');
  });
});
