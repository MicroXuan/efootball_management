import { jest } from '@jest/globals';
import { PersonalFinanceService } from './personal-finance.service.js';

const date = new Date('2026-10-20T00:00:00.000Z');
const row = {
  id: 'entry-1', userId: 'user-1', leagueId: 'league-1', leagueTeamId: 'team-1', seasonId: 'season-1',
  direction: 'DEBIT' as const, amountMinor: 200, title: '报名费', note: '', occurredOn: date,
  version: 1, createdAt: date, updatedAt: date,
};

function harness() {
  const prisma = {
    leagueTeam: { findFirst: jest.fn(async () => ({ leagueId: 'league-1' })) },
    leagueSeason: { findFirst: jest.fn(async () => ({ id: 'season-1' })) },
    personalFinanceEntry: {
      findMany: jest.fn(async () => [row, { ...row, id: 'entry-2', direction: 'CREDIT' as const, amountMinor: 500 }]),
      create: jest.fn(async () => row),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: jest.fn(async () => ({ ...row, version: 2 })),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
  };
  return { prisma, service: new PersonalFinanceService(prisma as never) };
}

describe('PersonalFinanceService', () => {
  it('lists only the owner’s team and season, with separate manual totals', async () => {
    const { prisma, service } = harness();
    await expect(service.list('user-1', 'team-1', 'season-1')).resolves.toMatchObject({
      creditTotalMinor: 500, debitTotalMinor: 200, balanceMinor: 300,
      items: expect.arrayContaining([expect.objectContaining({ title: '报名费', occurredOn: '2026-10-20' })]),
    });
    expect(prisma.personalFinanceEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1', leagueTeamId: 'team-1', seasonId: 'season-1' },
    }));
  });

  it('rejects another owner and a season in another league before reading or writing', async () => {
    const { prisma, service } = harness();
    prisma.leagueTeam.findFirst.mockResolvedValueOnce(null as never);
    await expect(service.list('stranger', 'team-1', 'season-1')).rejects.toMatchObject({ code: 'PERSONAL_FINANCE_FORBIDDEN' });
    prisma.leagueSeason.findFirst.mockResolvedValueOnce(null as never);
    await expect(service.create('user-1', 'team-1', {
      seasonId: 'other-season', direction: 'DEBIT', amountMinor: 200, title: '报名费', note: '', occurredOn: '2026-10-20',
    })).rejects.toMatchObject({ code: 'LEAGUE_SEASON_NOT_FOUND' });
    expect(prisma.personalFinanceEntry.create).not.toHaveBeenCalled();
  });

  it('updates only the owner’s version and deletes only the owner’s scoped entry', async () => {
    const { prisma, service } = harness();
    await service.update('user-1', 'team-1', 'entry-1', {
      seasonId: 'season-1', direction: 'CREDIT', amountMinor: 300, title: '奖金', note: '', occurredOn: '2026-10-20', expectedVersion: 1,
    });
    expect(prisma.personalFinanceEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'entry-1', userId: 'user-1', leagueTeamId: 'team-1', seasonId: 'season-1', version: 1 },
    }));
    await service.remove('user-1', 'team-1', 'season-1', 'entry-1');
    expect(prisma.personalFinanceEntry.deleteMany).toHaveBeenCalledWith({
      where: { id: 'entry-1', userId: 'user-1', leagueTeamId: 'team-1', seasonId: 'season-1' },
    });
  });
});
