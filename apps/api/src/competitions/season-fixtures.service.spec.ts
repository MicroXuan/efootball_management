/* eslint-disable @typescript-eslint/no-explicit-any -- focused Prisma projection fixtures */
import { jest } from '@jest/globals';
import { SeasonFixturesService } from './season-fixtures.service.js';

const at = new Date('2026-10-19T12:00:00.000Z');
const competition = {
  id: 'competition-1', seasonId: 'season-1', competitionType: 'DIVISION_LEAGUE', name: 'S1 分级联赛', description: '',
  platform: 'MOBILE', serverRegion: 'GLOBAL', participantType: 'TEAM', format: 'ROUND_ROBIN', status: 'IN_PROGRESS',
  registrationOpensAt: at, registrationClosesAt: at, startsAt: at, endsAt: at, participantLimit: 30,
  activeRuleVersion: 1, version: 1, createdAt: at, updatedAt: at, _count: { participants: 2 }
};

function participant(id: string, name: string, number: number, shortName: string, status = 'ACTIVE', leagueTeamId = `team-${number}`) {
  return { id, participantType: 'TEAM', displayNameSnapshot: name, seasonEntry: {
    leagueTeamId, teamNameSnapshot: name, teamShortNameSnapshot: shortName, teamNumberSnapshot: number,
    teamLogoUrlSnapshot: null, leagueTeam: { status, ownerAlias: `${name}经理`, teamNumber: number, name, shortName, logoUrl: null }
  } };
}

function match(id: string, roundNumber: number, matchNumber: number, finished = false) {
  return {
    id, stageId: 'stage-1', roundNumber, matchNumber, plannedAt: null,
    resultConfirmationDeadlineAt: null, status: finished ? 'ADMIN_DECIDED' : 'SCHEDULED',
    officialResultVersionId: finished ? `result-${id}` : null, version: 1, createdAt: at, updatedAt: at,
    stage: { id: 'stage-1', stageCode: 'CHAMPION_A', displayName: '冠军 A 组', competitionId: competition.id, competition },
    homeParticipant: participant(`home-${id}`, '阿哈尔', 1, 'AHAL'),
    awayParticipant: participant(`away-${id}`, 'AC Milan', 2, 'MILAN', id === 'finished' ? 'ARCHIVED' : 'ACTIVE'),
    officialResultVersion: finished ? { id: `result-${id}`, version: 1, homeScore: 2, awayScore: 1, status: 'OFFICIAL' } : null
  };
}

function harness(records: any[] = []) {
  const prisma: any = {
    seasonEntry: { findFirst: jest.fn(async () => ({ id: 'entry-1' })) },
    competitionMatch: { findMany: jest.fn(async () => records) }
  };
  return { service: new SeasonFixturesService(prisma), prisma };
}

describe('SeasonFixturesService', () => {
  it('requires an approved entry owned by the caller on an active team in the exact league and season', async () => {
    const { service, prisma } = harness();
    await service.list('user-1', 'league-1', 'season-1', { status: 'ALL', limit: 20 });
    expect(prisma.seasonEntry.findFirst).toHaveBeenCalledWith({ where: {
      ownerUserId: 'user-1', seasonId: 'season-1', status: 'APPROVED',
      leagueTeam: { leagueId: 'league-1', status: 'ACTIVE' },
      season: { leagueId: 'league-1', league: { isDeleted: false } }
    }, select: { id: true } });

    prisma.seasonEntry.findFirst.mockResolvedValueOnce(null);
    await expect(service.list('user-1', 'other-league', 'season-1', { status: 'ALL', limit: 20 }))
      .rejects.toMatchObject({ response: { code: 'SEASON_FIXTURE_ACCESS_DENIED' }, status: 403 });
  });

  it('queries only published stages and filters status by official-result presence', async () => {
    const { service, prisma } = harness([match('upcoming', 1, 1), match('finished', 1, 2, true)]);
    await expect(service.list('user-1', 'league-1', 'season-1', { status: 'UPCOMING', limit: 20 }))
      .resolves.toMatchObject({ items: [{ match: { id: 'upcoming', officialResult: null } }] });
    expect(prisma.competitionMatch.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { stage: { status: 'PUBLISHED', competition: { seasonId: 'season-1', season: { leagueId: 'league-1', league: { isDeleted: false } } } } }
    }));
  });

  it('normalizes current and snapshot names, short names, and padded team numbers without searching ids', async () => {
    const records = [match('upcoming', 1, 1), match('finished', 1, 2, true)];
    const { service } = harness(records);
    for (const team of ['  ac   MILAN ', 'ahal', '01']) {
      await expect(service.list('user-1', 'league-1', 'season-1', { team, status: 'ALL', limit: 20 }))
        .resolves.toMatchObject({ items: expect.arrayContaining([
          expect.objectContaining({ match: expect.objectContaining({ id: 'upcoming' }) })
        ]) });
    }
    await expect(service.list('user-1', 'league-1', 'season-1', { team: 'home-upcoming', status: 'ALL', limit: 20 }))
      .resolves.toEqual({ items: [], nextCursor: null });
  });

  it('keeps archived snapshot participants visible and paginates across the unfinished/finished boundary', async () => {
    const { service } = harness([match('finished', 1, 2, true), match('upcoming', 1, 1)]);
    const first = await service.list('user-1', 'league-1', 'season-1', { status: 'ALL', limit: 1 });
    expect(first.items[0]?.match.id).toBe('upcoming');
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await service.list('user-1', 'league-1', 'season-1', { status: 'ALL', limit: 1, cursor: first.nextCursor! });
    expect(second.items.map(({ match }) => match.id)).toEqual(['finished']);
    expect(second.items[0]?.match.awayParticipant).toMatchObject({ teamLifecycleStatus: 'ARCHIVED', teamName: 'AC Milan' });
    expect(new Set([...first.items, ...second.items].map(({ match }) => match.id)).size).toBe(2);
  });

  it('rejects malformed and filter-incompatible cursors', async () => {
    const { service } = harness([match('upcoming', 1, 1), match('upcoming-2', 1, 2)]);
    await expect(service.list('user-1', 'league-1', 'season-1', { status: 'ALL', limit: 1, cursor: 'bad' }))
      .rejects.toMatchObject({ response: { code: 'INVALID_FIXTURE_CURSOR' }, status: 400 });
    const first = await service.list('user-1', 'league-1', 'season-1', { team: 'ahal', status: 'ALL', limit: 1 });
    if (!first.nextCursor) return;
    await expect(service.list('user-1', 'league-1', 'season-1', { team: 'milan', status: 'ALL', limit: 1, cursor: first.nextCursor }))
      .rejects.toMatchObject({ response: { code: 'INVALID_FIXTURE_CURSOR' }, status: 400 });
  });

  it('filters mine by exact owned team id, not a matching team name, and rejects a foreign team', async () => {
    const own = match('own', 1, 1);
    const namesake = match('namesake', 1, 2);
    namesake.homeParticipant = participant('home-namesake', '阿哈尔', 1, 'AHAL', 'ACTIVE', 'team-other');
    const { service, prisma } = harness([own, namesake]);
    const query = { status: 'ALL' as const, scope: 'MINE' as const, leagueTeamId: 'team-1', limit: 20 };
    const result = await service.list('user-1', 'league-1', 'season-1', query);
    expect(result.items.map(({ match }) => match.id)).toEqual(['own']);
    expect(prisma.seasonEntry.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ leagueTeamId: 'team-1', ownerUserId: 'user-1', status: 'APPROVED' })
    }));
    prisma.seasonEntry.findFirst.mockResolvedValueOnce(null);
    await expect(service.list('user-1', 'league-1', 'season-1', { ...query, leagueTeamId: 'team-other' }))
      .rejects.toMatchObject({ status: 403 });
  });

  it('rejects a cursor from another scope or owned team', async () => {
    const { service } = harness([match('one', 1, 1), match('two', 1, 2)]);
    const first = await service.list('user-1', 'league-1', 'season-1', {
      status: 'ALL', scope: 'MINE', leagueTeamId: 'team-1', limit: 1
    });
    expect(first.nextCursor).toEqual(expect.any(String));
    await expect(service.list('user-1', 'league-1', 'season-1', {
      status: 'ALL', scope: 'MINE', leagueTeamId: 'team-2', limit: 1, cursor: first.nextCursor!
    })).rejects.toMatchObject({ response: { code: 'INVALID_FIXTURE_CURSOR' } });
    await expect(service.list('user-1', 'league-1', 'season-1', {
      status: 'ALL', scope: 'ALL', limit: 1, cursor: first.nextCursor!
    })).rejects.toMatchObject({ response: { code: 'INVALID_FIXTURE_CURSOR' } });
  });
});
