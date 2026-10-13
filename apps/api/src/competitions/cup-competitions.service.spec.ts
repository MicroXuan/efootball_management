import { describe, expect, it, jest } from '@jest/globals';
import { CupCompetitionsService } from './cup-competitions.service.js';

const now = new Date('2026-10-03T12:00:00.000Z');

function input() {
  return {
    seasonId: 'season-1',
    name: 'S3 足总杯',
    description: '赛季杯赛',
    competitionType: 'GROUP_KNOCKOUT_CUP' as const,
    format: 'GROUP_KNOCKOUT' as const,
    registrationOpensAt: '2026-10-01T12:00:00.000Z',
    registrationClosesAt: '2026-10-10T12:00:00.000Z',
    startsAt: '2026-10-11T12:00:00.000Z',
    endsAt: '2026-11-30T12:00:00.000Z',
    participantLimit: 32,
    targetGroupSize: 4,
    qualifiersPerGroup: 2
  };
}

function harness(options: { entryStatus?: string; ownerUserId?: string; participantCount?: number; existingStatus?: string; competitionStatus?: string } = {}) {
  const competition = {
    id: 'cup-1', seasonId: 'season-1', name: 'S3 足总杯', description: '赛季杯赛',
    competitionType: 'GROUP_KNOCKOUT_CUP', format: 'GROUP_KNOCKOUT', participantType: 'TEAM',
    platform: 'MOBILE', serverRegion: '国际服', status: options.competitionStatus ?? 'REGISTRATION_OPEN',
    registrationOpensAt: new Date('2026-10-01T12:00:00.000Z'),
    registrationClosesAt: new Date('2026-10-10T12:00:00.000Z'),
    startsAt: new Date('2026-10-11T12:00:00.000Z'), endsAt: new Date('2026-11-30T12:00:00.000Z'),
    participantLimit: 32, activeRuleVersion: 1, boundRuleVersion: 1, version: 1,
    createdAt: now, updatedAt: now,
    cupConfig: { targetGroupSize: 4, qualifiersPerGroup: 2, version: 1 }
  };
  const entry = {
    id: 'entry-1', seasonId: 'season-1', ownerUserId: options.ownerUserId ?? 'user-1',
    status: options.entryStatus ?? 'APPROVED', teamNameSnapshot: '上海海港', teamNumberSnapshot: 24,
    teamLogoUrlSnapshot: 'https://static.example.com/shanghai-port.png',
    leagueTeam: { status: 'ACTIVE', teamNumber: 25, name: '当前海港', logoUrl: null, ownerAlias: '小宣' }
  };
  const registration = {
    id: 'registration-1', competitionId: 'cup-1', applicantId: 'user-1', gameAccountId: null,
    seasonEntryId: 'entry-1', acceptedRuleVersion: 1, status: options.existingStatus ?? 'APPROVED', reviewReason: null,
    reviewedById: null, reviewedAt: now, withdrawnAt: null, version: 1, createdAt: now, updatedAt: now,
    seasonEntry: entry
  };
  const transaction = {
    $queryRaw: jest.fn(async () => []),
    leagueSeason: { findUnique: jest.fn(async () => ({
      id: 'season-1', leagueId: 'league-1', status: 'IN_PROGRESS',
      league: { defaultPlatform: 'PLAYSTATION', defaultServerRegion: '亚洲服' }
    })) },
    competition: {
      create: jest.fn(async (...args: unknown[]) => { void args; return competition; }),
      findUnique: jest.fn(async () => competition),
      updateMany: jest.fn(async ({ data }: { where?: Record<string, unknown>; data: { status: string; boundRuleVersion?: number; version?: unknown } }) => {
        competition.status = data.status;
        competition.version += 1;
        return { count: 1 };
      }),
      findMany: jest.fn(async (input: unknown) => {
        void input;
        return [{ ...competition, _count: { participants: 12 } }];
      })
    },
    competitionRuleVersion: {
      create: jest.fn(async (...args: unknown[]) => { void args; return { id: 'rule-1' }; })
    },
    seasonEntry: { findUnique: jest.fn(async () => entry) },
    competitionRegistration: {
      findUnique: jest.fn(async () => options.existingStatus ? registration : null),
      findFirst: jest.fn(async () => registration),
      count: jest.fn(async () => options.participantCount ?? 0),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'registration-1', version: 1, withdrawnAt: null, createdAt: now, updatedAt: now, ...data
      })),
      update: jest.fn(async ({ data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => ({
        ...registration, ...data,
        status: data.status as string,
        withdrawnAt: data.withdrawnAt === null ? null : now,
        version: 2
      }))
    },
    competitionParticipant: {
      aggregate: jest.fn(async () => ({ _max: { admissionSequence: 2 } })),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'participant-1', ...data })),
      deleteMany: jest.fn(async (input: { where: Record<string, unknown> }) => { void input; return { count: 1 }; }),
      findMany: jest.fn(async () => [{
        id: 'participant-1', participantType: 'TEAM', displayNameSnapshot: '上海海港',
        seasonEntry: entry
      }])
    }
  };
  const execute = jest.fn(async (
    _actor: string,
    _operation: string,
    _key: string,
    work: (client: typeof transaction) => Promise<unknown>
  ) => work(transaction));
  const authorization = {
    requireLeagueAccess: jest.fn(async (...args: string[]) => { void args; return { id: 'admin-1' }; })
  };
  const audit = { record: jest.fn(async (...args: unknown[]) => { void args; return undefined; }) };
  const service = new CupCompetitionsService(
    transaction as never,
    authorization as never,
    { execute } as never,
    { execute } as never,
    audit as never,
    { now: () => now } as never,
    { requireVisible: jest.fn(async () => 'league-1'), notFound: jest.fn() } as never
  );
  return { service, transaction, authorization, audit };
}

describe('CupCompetitionsService', () => {
  it('lists every cup in a league season with participant counts', async () => {
    const { service, transaction, authorization } = harness();

    const result = await service.listAdmin('admin-1', 'league-1', 'season-1');

    expect(authorization.requireLeagueAccess).toHaveBeenCalledWith('admin-1', 'league-1');
    expect(transaction.competition.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ seasonId: 'season-1' })
    }));
    expect(result.items).toEqual([expect.objectContaining({
      id: 'cup-1', participantCount: 12, targetGroupSize: 4
    })]);
  });

  it('creates a season-bound cup with group rules and an auditable default scoring rule', async () => {
    const { service, transaction, authorization, audit } = harness();

    const result = await service.create('admin-1', 'league-1', 'season-1', input(), 'create-cup');

    expect(authorization.requireLeagueAccess).toHaveBeenCalledWith('admin-1', 'league-1');
    expect(transaction.competition.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      seasonId: 'season-1', competitionType: 'GROUP_KNOCKOUT_CUP', participantType: 'TEAM',
      platform: 'PLAYSTATION', serverRegion: '亚洲服',
      cupConfig: { create: { targetGroupSize: 4, qualifiersPerGroup: 2 } }
    }) });
    expect(transaction.competitionRuleVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      competitionId: 'cup-1', createdByAdminId: 'admin-1', winPoints: 3, drawPoints: 1, lossPoints: 0
    }) });
    expect(audit.record).toHaveBeenCalledWith(transaction, expect.objectContaining({
      action: 'admin.cup.create', resourceId: 'cup-1', leagueId: 'league-1'
    }));
    expect(result).toMatchObject({ id: 'cup-1', targetGroupSize: 4, qualifiersPerGroup: 2 });
  });

  it('opens cup registration with an optimistic version and audit record', async () => {
    const { service, transaction, audit } = harness({ competitionStatus: 'DRAFT' });

    const result = await service.transitionRegistration(
      'admin-1', 'league-1', 'season-1', 'cup-1', 'REGISTRATION_OPEN',
      { expectedVersion: 1 }, 'open-cup'
    );

    expect(transaction.competition.updateMany).toHaveBeenCalledWith({
      where: { id: 'cup-1', version: 1 },
      data: { status: 'REGISTRATION_OPEN', boundRuleVersion: 1, version: { increment: 1 } }
    });
    expect(audit.record).toHaveBeenCalledWith(transaction, expect.objectContaining({
      action: 'admin.cup.registration.open', resourceId: 'cup-1'
    }));
    expect(result).toMatchObject({ status: 'REGISTRATION_OPEN', version: 2 });
  });

  it('lists registered teams with seasonal crest, number, name, and owner', async () => {
    const { service } = harness();

    await expect(service.listParticipants('cup-1')).resolves.toEqual([expect.objectContaining({
      id: 'participant-1', teamNumber: 24, teamName: '上海海港',
      teamLogoUrl: 'https://static.example.com/shanghai-port.png', ownerDisplayName: '小宣'
    })]);
  });

  it('closes an open cup registration window', async () => {
    const { service, transaction } = harness();

    await expect(service.transitionRegistration(
      'admin-1', 'league-1', 'season-1', 'cup-1', 'REGISTRATION_CLOSED',
      { expectedVersion: 1 }, 'close-cup'
    )).resolves.toMatchObject({ status: 'REGISTRATION_CLOSED', version: 2 });
    expect(transaction.competition.updateMany).toHaveBeenCalledWith({
      where: { id: 'cup-1', version: 1 },
      data: { status: 'REGISTRATION_CLOSED', version: { increment: 1 } }
    });
  });

  it('registers an approved owned season entry immediately without a game account', async () => {
    const { service, transaction } = harness();

    const result = await service.register('user-1', 'cup-1', {
      seasonEntryId: 'entry-1', acceptedRuleVersion: 1
    }, 'register-cup');

    expect(transaction.competitionRegistration.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      competitionId: 'cup-1', seasonEntryId: 'entry-1', applicantId: 'user-1',
      gameAccountId: null, status: 'APPROVED'
    }) });
    expect(transaction.competitionParticipant.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      competitionId: 'cup-1', seasonEntryId: 'entry-1', participantType: 'TEAM',
      displayNameSnapshot: '上海海港', admissionSequence: 3
    }) });
    expect(result).toMatchObject({ seasonEntryId: 'entry-1', teamName: '上海海港', status: 'APPROVED' });
  });

  it.each([
    ['PENDING', 'user-1', 'CUP_SEASON_ENTRY_INELIGIBLE'],
    ['APPROVED', 'another-user', 'CUP_SEASON_ENTRY_NOT_OWNED']
  ])('rejects an ineligible cup registration', async (entryStatus, ownerUserId, code) => {
    const { service, transaction } = harness({ entryStatus, ownerUserId });

    await expect(service.register('user-1', 'cup-1', {
      seasonEntryId: 'entry-1', acceptedRuleVersion: 1
    }, `register-${entryStatus}-${ownerUserId}`)).rejects.toMatchObject({ code });
    expect(transaction.competitionRegistration.create).not.toHaveBeenCalled();
  });

  it('reads and withdraws my team registration while the cup registration window is open', async () => {
    const { service, transaction, audit } = harness();

    await expect(service.getMine('user-1', 'cup-1')).resolves.toMatchObject({
      seasonEntryId: 'entry-1', teamName: '上海海港', status: 'APPROVED'
    });
    const withdrawn = await service.withdraw('user-1', 'cup-1', { expectedVersion: 1 }, 'withdraw-cup');

    expect(transaction.competitionParticipant.deleteMany).toHaveBeenCalledWith({
      where: { registrationId: 'registration-1' }
    });
    expect(transaction.competitionRegistration.update).toHaveBeenCalledWith({
      where: { id: 'registration-1' },
      data: { status: 'WITHDRAWN', withdrawnAt: now, version: { increment: 1 } }
    });
    expect(audit.record).toHaveBeenCalledWith(transaction, expect.objectContaining({
      action: 'cup.registration.withdraw', resourceId: 'registration-1'
    }));
    expect(withdrawn).toMatchObject({ status: 'WITHDRAWN', version: 2 });
  });

  it('allows a withdrawn team to register again while the window remains open', async () => {
    const { service, transaction } = harness({ existingStatus: 'WITHDRAWN' });

    const result = await service.register('user-1', 'cup-1', {
      seasonEntryId: 'entry-1', acceptedRuleVersion: 1
    }, 'register-again');

    expect(transaction.competitionRegistration.update).toHaveBeenCalledWith({
      where: { id: 'registration-1' },
      data: expect.objectContaining({ status: 'APPROVED', withdrawnAt: null, version: { increment: 1 } })
    });
    expect(transaction.competitionParticipant.create).toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'APPROVED', version: 2 });
  });
});
