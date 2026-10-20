import { jest } from '@jest/globals';
import { SeasonCalendarService } from './season-calendar.service.js';
import { LeagueError } from '../leagues/league.errors.js';

const now = new Date('2026-10-20T12:00:00.000Z');

function harness() {
  const prisma = {
    league: { findUnique: jest.fn(async () => ({ id: 'league-1', currentSeasonId: 'season-1', isDeleted: false })) },
    competitionMatch: { findMany: jest.fn(async () => [
      { id: 'fixture-1', plannedAt: new Date('2026-10-25T12:00:00.000Z'), officialResultVersionId: null,
        homeParticipant: { displayNameSnapshot: '阿哈尔' }, awayParticipant: { displayNameSnapshot: '阿贾克斯' } },
      { id: 'fixture-unpublished', plannedAt: null, officialResultVersionId: null,
        homeParticipant: { displayNameSnapshot: '隐藏' }, awayParticipant: { displayNameSnapshot: '隐藏' } }
    ]) },
    transferWindow: { findMany: jest.fn(async () => [
      { id: 'transfer-1', name: '秋季转会期', startsAt: new Date('2026-10-19T00:00:00.000Z'), endsAt: new Date('2026-10-29T00:00:00.000Z') }
    ]) },
    valuationWindow: { findMany: jest.fn(async () => [
      { id: 'valuation-1', name: '身价调整', startsAt: new Date('2026-10-01T00:00:00.000Z'), endsAt: new Date('2026-10-10T00:00:00.000Z'), closedAt: null }
    ]) },
    nominationWindow: { findMany: jest.fn(async () => [
      { id: 'nomination-1', startsAt: new Date('2026-10-15T00:00:00.000Z'), endsAt: new Date('2026-10-18T00:00:00.000Z') }
    ]) },
    forcedOfferWindow: { findMany: jest.fn(async () => [
      { id: 'forced-1', name: '第一轮强报', startsAt: new Date('2026-10-20T00:00:00.000Z'), endsAt: new Date('2026-10-22T16:00:00.000Z') }
    ]) },
    seasonCalendarNote: { findMany: jest.fn(async () => [
      { id: 'note-1', kind: 'HOLIDAY', title: '假期', description: '暂停考核', version: 1, startsOn: new Date('2026-10-01T00:00:00Z'), endsOn: new Date('2026-10-07T00:00:00Z') }
    ]) }
  };
  const visibility = { requireVisible: jest.fn(async () => 'league-1'), notFound: () => new LeagueError('LEAGUE_NOT_FOUND', 'not found', 404) };
  const authorization = { requireLeagueManager: jest.fn(async () => ({})) };
  return { service: new SeasonCalendarService(prisma as never, visibility as never, authorization as never), prisma, visibility, authorization };
}

describe('SeasonCalendarService', () => {
  it('combines four phase windows and notes without querying fixtures', async () => {
    const { service, prisma } = harness();
    const result = await service.listForUser('user-1', 'league-1', 'season-1', '2026-10', now);
    expect(result.items.map((item) => [item.kind, item.status])).toEqual([
      ['MANUAL', 'ENDED'], ['VALUATION', 'ENDED'], ['NOMINATION', 'ENDED'], ['TRANSFER', 'ACTIVE'], ['FORCED_OFFER', 'ACTIVE']
    ]);
    expect(result).toMatchObject({ seasonId: 'season-1', timezone: 'Asia/Shanghai' });
    expect(result.items.find((item) => item.kind === 'FORCED_OFFER')).toMatchObject({ firstDate: '2026-10-20', lastDate: '2026-10-22' });
    expect(result.items.find((item) => item.kind === 'MANUAL')).toMatchObject({ firstDate: '2026-10-01', lastDate: '2026-10-07' });
    expect(prisma.competitionMatch.findMany).not.toHaveBeenCalled();
    expect(prisma.transferWindow.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ seasonId: 'season-1' }) }));
  });

  it('allows logged-in nonparticipants but denies cross-league or stale seasons', async () => {
    const { service, prisma, visibility } = harness();
    visibility.requireVisible.mockResolvedValueOnce('league-2');
    await expect(service.listForUser('user-1', 'league-1', 'season-1', '2026-10', now)).rejects.toMatchObject({ status: 404 });
    await expect(service.listForUser('outsider', 'league-1', 'season-1', '2026-10', now)).resolves.toMatchObject({ seasonId: 'season-1' });
    prisma.league.findUnique.mockResolvedValueOnce({ id: 'league-1', currentSeasonId: 'season-2', isDeleted: false });
    await expect(service.listForUser('user-1', 'league-1', 'season-1', '2026-10', now)).rejects.toMatchObject({ status: 404 });
  });

  it('marks a window active at its exact start and ended at its exact end', async () => {
    const { service } = harness();
    const atStart = await service.listForUser('user-1', 'league-1', 'season-1', '2026-10', new Date('2026-10-19T00:00:00.000Z'));
    const atEnd = await service.listForUser('user-1', 'league-1', 'season-1', '2026-10', new Date('2026-10-29T00:00:00.000Z'));
    expect(atStart.items.find((item) => item.kind === 'TRANSFER')?.status).toBe('ACTIVE');
    expect(atEnd.items.find((item) => item.kind === 'TRANSFER')?.status).toBe('ENDED');
  });

  it('uses Beijing month boundaries and excludes the day at an exact local midnight close', async () => {
    const { service, prisma } = harness();
    prisma.transferWindow.findMany.mockResolvedValueOnce([
      { id: 'cross-month', name: '跨月转会', startsAt: new Date('2026-09-30T15:00:00Z'), endsAt: new Date('2026-10-01T16:00:00Z') },
      { id: 'next-month', name: '十一月', startsAt: new Date('2026-10-31T16:00:00Z'), endsAt: new Date('2026-11-02T00:00:00Z') }
    ]);
    const result = await service.listForUser('user-1', 'league-1', 'season-1', '2026-10', now);
    expect(result.items.find((item) => item.id === 'cross-month')).toMatchObject({ firstDate: '2026-09-30', lastDate: '2026-10-01' });
    expect(result.items.some((item) => item.id === 'next-month')).toBe(false);
    expect(prisma.transferWindow.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ startsAt: { lt: new Date('2026-10-31T16:00:00Z') }, endsAt: { gt: new Date('2026-09-30T16:00:00Z') } })
    }));
  });

  it('returns an empty current-season state and checks admin grants', async () => {
    const { service, prisma, authorization } = harness();
    prisma.league.findUnique.mockResolvedValueOnce({ id: 'league-1', currentSeasonId: null, isDeleted: false } as never);
    await expect(service.listForAdmin('admin-1', 'league-1', '2026-10', now)).resolves.toEqual({ month: '2026-10', seasonId: null, timezone: 'Asia/Shanghai', items: [] });
    authorization.requireLeagueManager.mockRejectedValueOnce(new LeagueError('FORBIDDEN', 'No grant', 403));
    await expect(service.listForAdmin('admin-2', 'league-1', '2026-10', now)).rejects.toMatchObject({ status: 403 });
  });
});
