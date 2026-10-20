import { jest } from '@jest/globals';
import { NominationService } from './nomination.service.js';

const window = { id: 'window-1', seasonId: 'season-1', startsAt: new Date('2026-10-20T00:00:00.000Z'), endsAt: new Date('2026-10-25T00:00:00.000Z'), perTeamLimit: 2, season: { leagueId: 'league-1' } };
const scope = { leagueId: 'league-1', seasonId: 'season-1', leagueTeamId: 'team-1' };
const player = { id: '11111111-1111-4111-8111-111111111111', nameZh: '瓦拉内', nameEn: 'Raphaël Varane', publishedAt: new Date(), cards: [{ id: '44444444-4444-4444-8444-444444444444', cardName: '传奇' }] };
const player2 = '22222222-2222-4222-8222-222222222222';
const player3 = '33333333-3333-4333-8333-333333333333';

function harness() {
  const nominations: Array<Record<string, unknown>> = [];
  const tx = {
    $queryRaw: jest.fn(async () => []),
    nominationWindow: { findUnique: jest.fn(async () => window) },
    footballPlayer: { findFirst: jest.fn(async () => player) },
    leaguePlayerOwnership: { findUnique: jest.fn(async () => null as { status: string } | null) },
    playerNomination: {
      findUnique: jest.fn(async ({ where }: { where: { id?: string, windowId_leagueTeamId_footballPlayerId?: { footballPlayerId: string } } }) =>
        nominations.find((item) => where.id ? item.id === where.id : item.footballPlayerId === where.windowId_leagueTeamId_footballPlayerId?.footballPlayerId) ?? null),
      count: jest.fn(async () => nominations.filter((item) => item.withdrawnAt === null).length),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { const value = { id: `nomination-${nominations.length + 1}`, createdAt: new Date(), withdrawnAt: null, footballPlayer: player, ...data }; nominations.push(value); return value; }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { Object.assign(nominations[0]!, data); return nominations[0]!; }),
      findMany: jest.fn(async () => nominations)
    }
  };
  const prisma = { nominationWindow: tx.nominationWindow, playerNomination: tx.playerNomination, leaguePlayerOwnership: { findMany: jest.fn(async () => [] as Array<{ footballPlayerId: string }>) } };
  const access = { requireParticipant: jest.fn(async () => scope) };
  const authorization = { requireLeagueManager: jest.fn(async () => undefined) };
  const service = new NominationService(prisma as never, access as never, authorization as never, { execute: async (_user: unknown, _op: unknown, _key: unknown, work: (client: unknown) => Promise<unknown>) => work(tx) } as never);
  return { service, tx, prisma, nominations, access, authorization };
}

describe('NominationService', () => {
  it('permits a free published player once and rejects owned or over-cap selections', async () => {
    const { service, tx, nominations } = harness();
    const at = new Date('2026-10-21T00:00:00.000Z');
    const first = await service.submit('user-1', window.id, { playerId: player.id }, 'k1', at);
    expect(first.id).toBe('nomination-1');
    expect(await service.submit('user-1', window.id, { playerId: player.id }, 'k2', at)).toMatchObject({ id: first.id });
    expect(nominations).toHaveLength(1);
    tx.leaguePlayerOwnership.findUnique.mockResolvedValueOnce({ status: 'ACTIVE' });
    await expect(service.submit('user-1', window.id, { playerId: player2 }, 'k3', at)).rejects.toMatchObject({ status: 409 });
    nominations.push({ id: 'nomination-2', withdrawnAt: null });
    await expect(service.submit('user-1', window.id, { playerId: player3 }, 'k4', at)).rejects.toMatchObject({ status: 409 });
  });

  it('denies submission at the exact end and allows withdrawal only before it', async () => {
    const { service } = harness();
    const at = new Date('2026-10-21T00:00:00.000Z');
    const first = await service.submit('user-1', window.id, { playerId: player.id }, 'k1', at);
    await expect(service.submit('user-1', window.id, { playerId: player2 }, 'k2', window.endsAt)).rejects.toMatchObject({ status: 409 });
    await expect(service.withdraw('user-1', window.id, first.id, 'k3', window.endsAt)).rejects.toMatchObject({ status: 409 });
    expect(await service.withdraw('user-1', window.id, first.id, 'k4', at)).toMatchObject({ withdrawnAt: expect.any(String) });
  });

  it('reports server-clock availability at the exact window boundary', async () => {
    const { service } = harness();
    expect((await service.workspace('user-1', window.id, window.startsAt)).isOpen).toBe(true);
    expect((await service.workspace('user-1', window.id, window.endsAt)).isOpen).toBe(false);
  });

  it('aggregates two teams nominating one player into one admin candidate', async () => {
    const { service, prisma, authorization } = harness();
    prisma.playerNomination.findMany.mockResolvedValueOnce([
      { id: 'n1', footballPlayerId: player.id, footballPlayer: player, leagueTeam: { id: 'team-1', name: '巴萨', teamNumber: 4, ownerAlias: '小新' } },
      { id: 'n2', footballPlayerId: player.id, footballPlayer: player, leagueTeam: { id: 'team-2', name: '阿贾克斯', teamNumber: 3, ownerAlias: 'Tidus' } }
    ] as never);
    const candidates = await service.candidates('admin-1', 'league-1', window.id);
    expect(authorization.requireLeagueManager).toHaveBeenCalledWith('admin-1', 'league-1');
    expect(candidates.items).toHaveLength(1);
    expect(candidates.items[0]).toMatchObject({ playerId: player.id, nominatorCount: 2 });
  });
});
