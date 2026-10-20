import { jest } from '@jest/globals';
import { SeasonCalendarService } from './season-calendar.service.js';
import { LeagueError } from '../leagues/league.errors.js';

const now = new Date('2026-10-20T12:00:00.000Z');

function harness() {
  const prisma = {
    seasonEntry: { findFirst: jest.fn<() => Promise<{ id: string } | null>>(async () => ({ id: 'entry-1' })) },
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
    ]) }
  };
  const visibility = { requireVisible: jest.fn(async () => 'league-1'), notFound: () => new LeagueError('LEAGUE_NOT_FOUND', 'not found', 404) };
  return { service: new SeasonCalendarService(prisma as never, visibility as never), prisma, visibility };
}

describe('SeasonCalendarService', () => {
  it('combines published fixtures and season windows in time order with boundary-driven status', async () => {
    const { service, prisma } = harness();
    const result = await service.list('user-1', 'league-1', 'season-1', '2026-10', now);
    expect(result.items.map((item) => [item.kind, item.status])).toEqual([
      ['VALUATION', 'ENDED'], ['NOMINATION', 'ENDED'], ['TRANSFER', 'ACTIVE'], ['FIXTURE', 'UPCOMING']
    ]);
    expect(result.items[3]).toMatchObject({ title: '阿哈尔 vs 阿贾克斯', targetPath: expect.stringContaining('/pages/my-matches/index') });
    expect(result.items[1]).toMatchObject({ title: '球员提名期', targetPath: expect.stringContaining('/pages/player-nominations/index') });
    expect(prisma.competitionMatch.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ stage: expect.objectContaining({ status: 'PUBLISHED' }) })
    }));
    expect(prisma.transferWindow.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ seasonId: 'season-1' }) }));
  });

  it('denies cross-league seasons and users without approved participation', async () => {
    const { service, prisma, visibility } = harness();
    visibility.requireVisible.mockResolvedValueOnce('league-2');
    await expect(service.list('user-1', 'league-1', 'season-1', '2026-10', now)).rejects.toMatchObject({ status: 404 });
    prisma.seasonEntry.findFirst.mockResolvedValueOnce(null);
    await expect(service.list('outsider', 'league-1', 'season-1', '2026-10', now)).rejects.toMatchObject({ status: 403 });
  });

  it('marks a window active at its exact start and ended at its exact end', async () => {
    const { service } = harness();
    const atStart = await service.list('user-1', 'league-1', 'season-1', '2026-10', new Date('2026-10-19T00:00:00.000Z'));
    const atEnd = await service.list('user-1', 'league-1', 'season-1', '2026-10', new Date('2026-10-29T00:00:00.000Z'));
    expect(atStart.items.find((item) => item.kind === 'TRANSFER')?.status).toBe('ACTIVE');
    expect(atEnd.items.find((item) => item.kind === 'TRANSFER')?.status).toBe('ENDED');
  });
});
