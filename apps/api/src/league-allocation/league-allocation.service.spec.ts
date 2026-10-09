import { jest } from '@jest/globals';
import { LeagueAllocationService } from './league-allocation.service.js';

const createdAt = new Date('2026-10-03T00:00:00.000Z');

function approvedEntries(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `entry-${index + 1}`,
    teamNameSnapshot: `球队 ${index + 1}`,
    previousSeasonEntryId: null,
    status: 'APPROVED'
  }));
}

function harness(seasonOverrides: Record<string, unknown> = {}) {
  let proposalVersion = 0;
  const season = {
    id: 'season-1',
    leagueId: 'league-1',
    previousSeasonId: null,
    isFirstSeason: true,
    championCapacity: 18,
    superCapacity: 23,
    promotionCount: 4,
    status: 'ALLOCATION_REVIEW',
    version: 3,
    entries: approvedEntries(19),
    ...seasonOverrides
  };
  const transaction = {
    $queryRaw: jest.fn(async () => []),
    leagueSeason: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => where.id === season.id ? season : null)
    },
    competition: { findFirst: jest.fn(async () => null) },
    seasonAllocationProposal: {
      findFirst: jest.fn(async () => proposalVersion ? { version: proposalVersion } : null),
      updateMany: jest.fn(async () => ({ count: proposalVersion ? 1 : 0 })),
      create: jest.fn(async ({ data }: { data: {
        seasonId: string;
        version: number;
        algorithmVersion: string;
        randomSeed: number;
        rows: { create: Array<Record<string, unknown>> };
      } }) => {
        proposalVersion = data.version;
        return {
          id: `proposal-${proposalVersion}`,
          seasonId: data.seasonId,
          version: data.version,
          status: 'DRAFT',
          algorithmVersion: data.algorithmVersion,
          randomSeed: data.randomSeed,
          createdAt,
          rows: data.rows.create.map((row: Record<string, unknown>, index: number) => ({
            id: `row-${proposalVersion}-${index + 1}`,
            proposalId: `proposal-${proposalVersion}`,
            ...row
          }))
        };
      })
    }
  };
  const cache = new Map<string, unknown>();
  const receipts = {
    execute: jest.fn(async (
      _actor: string,
      operation: string,
      key: string,
      work: (value: typeof transaction) => Promise<unknown>
    ) => {
      const cacheKey = `${operation}:${key}`;
      if (cache.has(cacheKey)) return cache.get(cacheKey);
      const value = await work(transaction);
      cache.set(cacheKey, value);
      return value;
    })
  };
  const authorization = { requireLeagueAccess: jest.fn(async () => ({ id: 'admin-1' })) };
  const audit = { record: jest.fn(async () => undefined) };
  const prisma = {
    ...transaction,
    seasonAllocationProposal: {
      ...transaction.seasonAllocationProposal,
      findFirst: jest.fn(async () => null)
    }
  };
  const service = new LeagueAllocationService(
    prisma as never,
    authorization as never,
    receipts as never,
    audit as never,
    { requireVisible: jest.fn(async () => 'league-1'), notFound: jest.fn() } as never
  );
  return { service, transaction, receipts, audit, season };
}

function confirmationHarness(options: { published?: boolean; seasonVersion?: number } = {}) {
  const seasonVersion = options.seasonVersion ?? 3;
  const entries = approvedEntries(2);
  const season = {
    id: 'season-1', leagueId: 'league-1', displayName: 'S1',
    status: options.published ? 'READY' : 'ALLOCATION_REVIEW',
    version: seasonVersion, registrationOpensAt: new Date('2026-09-01T00:00:00.000Z'),
    registrationClosesAt: new Date('2026-09-08T00:00:00.000Z'),
    startsAt: new Date('2026-09-09T00:00:00.000Z'), endsAt: new Date('2026-10-09T00:00:00.000Z'),
    superCapacity: 23, championCapacity: 18, entries
  };
  const proposal = {
    id: 'proposal-1', seasonId: 'season-1', version: 1, status: 'DRAFT',
    rows: entries.map((entry, index) => ({
      id: `row-${index + 1}`,
      proposalId: 'proposal-1',
      seasonEntryId: entry.id,
      teamName: entry.teamNameSnapshot,
      suggestedStageCode: 'CHAMPION_A'
    }))
  };
  let confirmed = false;
  const transaction = {
    $queryRaw: jest.fn(async () => []),
    leagueSeason: {
      findUnique: jest.fn(async () => ({ ...season, status: confirmed ? 'READY' : season.status })),
      updateMany: jest.fn(async () => {
        if (confirmed) return { count: 0 };
        confirmed = true;
        return { count: 1 };
      })
    },
    league: {
      findUnique: jest.fn(async () => ({
        id: 'league-1', name: '测试联赛', defaultPlatform: 'MOBILE', defaultServerRegion: 'GLOBAL'
      }))
    },
    seasonAllocationProposal: {
      findUnique: jest.fn(async () => proposal),
      findFirst: jest.fn(async () => ({ id: 'proposal-1', version: 1 })),
      updateMany: jest.fn(async () => ({ count: 1 }))
    },
    competition: {
      findFirst: jest.fn(async () => options.published ? {
        id: 'competition-1', stages: [{ id: 'stage-1', status: 'PUBLISHED' }]
      } : null),
      create: jest.fn(async () => ({ id: 'competition-1' })),
      delete: jest.fn(async () => ({ id: 'competition-1' }))
    },
    competitionStage: {
      create: jest.fn(async ({ data }: { data: { stageCode: string } }) => ({
        id: `stage-${data.stageCode}`, ...data
      })),
      deleteMany: jest.fn(async () => ({ count: 1 }))
    },
    competitionParticipant: {
      create: jest.fn(async ({ data }: { data: { seasonEntryId: string } }) => ({
        id: `participant-${data.seasonEntryId}`, ...data
      })),
      deleteMany: jest.fn(async () => ({ count: 2 }))
    },
    stageParticipant: {
      createMany: jest.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
      deleteMany: jest.fn(async () => ({ count: 2 }))
    },
    seasonAllocationDecision: {
      createMany: jest.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length }))
    }
  };
  const cache = new Map<string, unknown>();
  const receipts = {
    execute: jest.fn(async (
      actor: string,
      operation: string,
      key: string,
      work: (value: typeof transaction) => Promise<unknown>
    ) => {
      const cacheKey = `${actor}:${operation}:${key}`;
      if (cache.has(cacheKey)) return cache.get(cacheKey);
      const value = await work(transaction);
      cache.set(cacheKey, value);
      return value;
    })
  };
  const authorization = { requireLeagueAccess: jest.fn(async () => ({ id: 'admin-1' })) };
  const audit = { record: jest.fn(async () => undefined) };
  const service = new LeagueAllocationService(
    transaction as never,
    authorization as never,
    receipts as never,
    audit as never,
    { requireVisible: jest.fn(async () => 'league-1'), notFound: jest.fn() } as never
  );
  return { service, transaction, proposal, season };
}

describe('LeagueAllocationService', () => {
  it('uses only approved entries from active teams and never creates a super group for the first season', async () => {
    const { service, transaction } = harness();

    const result = await service.generate('admin-1', 'league-1', 'season-1', {
      expectedSeasonVersion: 3,
      randomSeed: 20261003
    }, 'allocation-1');

    expect(transaction.leagueSeason.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        entries: expect.objectContaining({
          where: { status: 'APPROVED', leagueTeam: { status: 'ACTIVE' } }
        })
      })
    }));
    expect(result.rows).toHaveLength(19);
    expect(result.rows.some((row) => row.suggestedStageCode === 'SUPER')).toBe(false);
  });

  it('rejects generation outside allocation review with a Chinese business message', async () => {
    const { service } = harness({ status: 'REGISTRATION_OPEN' });

    await expect(service.generate('admin-1', 'league-1', 'season-1', {
      expectedSeasonVersion: 3,
      randomSeed: 7
    }, 'allocation-state')).rejects.toMatchObject({
      code: 'SEASON_NOT_IN_ALLOCATION_REVIEW',
      message: expect.stringContaining('分组确认')
    });
  });

  it('replays the same idempotency key and creates a new version for a new key', async () => {
    const { service, transaction } = harness();
    const input = { expectedSeasonVersion: 3, randomSeed: 42 };

    const first = await service.generate('admin-1', 'league-1', 'season-1', input, 'same-key');
    const replay = await service.generate('admin-1', 'league-1', 'season-1', input, 'same-key');
    const next = await service.generate('admin-1', 'league-1', 'season-1', input, 'new-key');

    expect(replay).toEqual(first);
    expect(next.version).toBe(2);
    expect(transaction.seasonAllocationProposal.create).toHaveBeenCalledTimes(2);
    expect(transaction.seasonAllocationProposal.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { seasonId: 'season-1', status: 'DRAFT' },
      data: { status: 'SUPERSEDED' }
    }));
  });

  it('rejects stale season versions before saving a proposal', async () => {
    const { service, transaction } = harness();

    await expect(service.generate('admin-1', 'league-1', 'season-1', {
      expectedSeasonVersion: 2,
      randomSeed: 7
    }, 'allocation-stale')).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(transaction.seasonAllocationProposal.create).not.toHaveBeenCalled();
  });

  it('returns a Chinese error when a regular season has no completed previous standings', async () => {
    const { service } = harness({
      isFirstSeason: false,
      previousSeasonId: 'season-previous',
      entries: approvedEntries(2).map((entry, index) => ({
        ...entry,
        previousSeasonEntryId: `previous-entry-${index + 1}`
      }))
    });

    await expect(service.generate('admin-1', 'league-1', 'season-1', {
      expectedSeasonVersion: 3,
      randomSeed: 7
    }, 'allocation-regular')).rejects.toMatchObject({
      code: 'PREVIOUS_STANDINGS_UNAVAILABLE',
      message: expect.stringContaining('上一赛季')
    });
  });

  it('confirms every approved team into one formal competition and complete stage membership', async () => {
    const { service, transaction } = confirmationHarness();

    const result = await service.confirm('admin-1', 'league-1', 'season-1', {
      proposalId: 'proposal-1', expectedSeasonVersion: 3, overrides: []
    }, 'confirm-1');

    expect(result).toMatchObject({
      seasonId: 'season-1', competitionId: 'competition-1', stageCount: 1,
      participantCount: 2, status: 'READY', version: 4
    });
    expect(transaction.competition.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ competitionType: 'DIVISION_LEAGUE', createdByAdminId: 'admin-1' })
    }));
    expect(transaction.competitionParticipant.create).toHaveBeenCalledTimes(2);
    expect(transaction.stageParticipant.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ stageId: 'stage-CHAMPION_A', participantId: 'participant-entry-1' })
      ])
    });
    expect(transaction.seasonAllocationDecision.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([expect.objectContaining({ overridden: false, reason: null })])
    });
  });

  it('requires a reason for a changed stage and rejects proposal teams outside approved entries', async () => {
    const first = confirmationHarness();
    await expect(first.service.confirm('admin-1', 'league-1', 'season-1', {
      proposalId: 'proposal-1', expectedSeasonVersion: 3,
      overrides: [{ seasonEntryId: 'entry-1', targetStageCode: 'CHAMPION_B', reason: ' ' }]
    }, 'confirm-empty-reason')).rejects.toMatchObject({ code: 'OVERRIDE_REASON_REQUIRED' });

    const second = confirmationHarness();
    second.proposal.rows.push({
      id: 'row-foreign', proposalId: 'proposal-1', seasonEntryId: 'entry-foreign',
      teamName: '外部球队', suggestedStageCode: 'CHAMPION_A'
    });
    await expect(second.service.confirm('admin-1', 'league-1', 'season-1', {
      proposalId: 'proposal-1', expectedSeasonVersion: 3, overrides: []
    }, 'confirm-foreign')).rejects.toMatchObject({ code: 'ALLOCATION_PARTICIPANTS_INVALID' });
  });

  it('rejects stale proposals and season versions', async () => {
    const staleVersion = confirmationHarness();
    await expect(staleVersion.service.confirm('admin-1', 'league-1', 'season-1', {
      proposalId: 'proposal-1', expectedSeasonVersion: 2, overrides: []
    }, 'confirm-stale-season')).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });

    const staleProposal = confirmationHarness();
    staleProposal.transaction.seasonAllocationProposal.findFirst.mockResolvedValue({ id: 'proposal-2', version: 2 });
    await expect(staleProposal.service.confirm('admin-1', 'league-1', 'season-1', {
      proposalId: 'proposal-1', expectedSeasonVersion: 3, overrides: []
    }, 'confirm-stale-proposal')).rejects.toMatchObject({ code: 'ALLOCATION_PROPOSAL_STALE' });
  });

  it('replays one confirmation but rejects a competing confirmation after the season advances', async () => {
    const { service, transaction } = confirmationHarness();
    const input = { proposalId: 'proposal-1', expectedSeasonVersion: 3, overrides: [] };
    const first = await service.confirm('admin-1', 'league-1', 'season-1', input, 'confirm-replay');
    await expect(service.confirm('admin-1', 'league-1', 'season-1', input, 'confirm-replay')).resolves.toEqual(first);
    await expect(service.confirm('admin-2', 'league-1', 'season-1', input, 'confirm-race'))
      .rejects.toMatchObject({ code: 'SEASON_NOT_IN_ALLOCATION_REVIEW' });
    expect(transaction.competition.create).toHaveBeenCalledTimes(1);
  });

  it('does not reopen allocation after any stage schedule is published', async () => {
    const { service } = confirmationHarness({ published: true });
    await expect(service.reopen('admin-1', 'league-1', 'season-1', {
      expectedVersion: 3
    }, 'reopen-published')).rejects.toMatchObject({
      code: 'ALLOCATION_REOPEN_FORBIDDEN',
      message: expect.stringContaining('赛程')
    });
  });
});
