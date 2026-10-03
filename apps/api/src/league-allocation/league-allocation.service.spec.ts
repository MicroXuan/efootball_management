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
    audit as never
  );
  return { service, transaction, receipts, audit, season };
}

describe('LeagueAllocationService', () => {
  it('uses only approved entries and never creates a super group for the first season', async () => {
    const { service, transaction } = harness();

    const result = await service.generate('admin-1', 'league-1', 'season-1', {
      expectedSeasonVersion: 3,
      randomSeed: 20261003
    }, 'allocation-1');

    expect(transaction.leagueSeason.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        entries: expect.objectContaining({ where: { status: 'APPROVED' } })
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
});
