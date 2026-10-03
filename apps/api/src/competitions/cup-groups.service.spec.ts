import { describe, expect, it, jest } from '@jest/globals';
import { CupGroupsService } from './cup-groups.service.js';

const createdAt = new Date('2026-10-03T12:00:00.000Z');

function participants(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `participant-${index + 1}`,
    displayNameSnapshot: `球队 ${index + 1}`
  }));
}

function harness() {
  let proposalVersion = 0;
  const competition = {
    id: 'cup-1', seasonId: 'season-1', competitionType: 'GROUP_KNOCKOUT_CUP',
    status: 'REGISTRATION_CLOSED', version: 2,
    season: { id: 'season-1', leagueId: 'league-1' },
    cupConfig: { targetGroupSize: 4, qualifiersPerGroup: 2 },
    participants: participants(10)
  };
  const transaction = {
    $queryRaw: jest.fn(async () => []),
    competition: { findUnique: jest.fn(async () => competition) },
    cupGroupProposal: {
      findFirst: jest.fn(async () => proposalVersion ? { version: proposalVersion } : null),
      updateMany: jest.fn(async (...args: unknown[]) => { void args; return { count: proposalVersion ? 1 : 0 }; }),
      create: jest.fn(async ({ data }: { data: {
        competitionId: string;
        version: number;
        algorithmVersion: string;
        randomSeed: number;
        rows: { create: Array<Record<string, unknown>> };
      } }) => {
        proposalVersion = data.version;
        return {
          id: `proposal-${proposalVersion}`,
          competitionId: data.competitionId,
          version: data.version,
          status: 'DRAFT',
          algorithmVersion: data.algorithmVersion,
          randomSeed: data.randomSeed,
          createdAt,
          rows: data.rows.create.map((row, index) => ({
            id: `row-${index + 1}`, proposalId: `proposal-${proposalVersion}`,
            finalGroupCode: null, overridden: false, reason: null, ...row
          }))
        };
      })
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
  const service = new CupGroupsService(
    transaction as never,
    authorization as never,
    { execute } as never,
    audit as never
  );
  return { service, transaction };
}

function confirmationHarness() {
  const rows = participants(8).map((participant, index) => ({
    id: `row-${index + 1}`,
    proposalId: 'proposal-1',
    participantId: participant.id,
    teamName: participant.displayNameSnapshot,
    suggestedGroupCode: index < 4 ? 'GROUP_A' : 'GROUP_B',
    finalGroupCode: null,
    overridden: false,
    reason: null
  }));
  const competition = {
    id: 'cup-1', seasonId: 'season-1', competitionType: 'GROUP_KNOCKOUT_CUP',
    status: 'REGISTRATION_CLOSED', version: 2,
    season: { id: 'season-1', leagueId: 'league-1' },
    cupConfig: { targetGroupSize: 4, qualifiersPerGroup: 2 },
    participants: participants(8)
  };
  const transaction = {
    $queryRaw: jest.fn(async () => []),
    competition: {
      findUnique: jest.fn(async () => competition),
      updateMany: jest.fn(async (...args: unknown[]) => { void args; return { count: 1 }; })
    },
    cupGroupProposal: {
      findUnique: jest.fn(async () => ({
        id: 'proposal-1', competitionId: 'cup-1', version: 1, status: 'DRAFT',
        algorithmVersion: 'cup-groups-v1', randomSeed: 7, createdAt, rows
      })),
      updateMany: jest.fn(async (...args: unknown[]) => { void args; return { count: 1 }; })
    },
    cupGroupProposalRow: {
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
        ...rows.find((row) => row.id === where.id), ...data
      }))
    },
    competitionStage: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: { data: { stageCode: string; displayName: string } }) => ({
        id: `stage-${data.stageCode}`, version: 1, status: 'DRAFT', ...data
      }))
    },
    stageParticipant: {
      createMany: jest.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length }))
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
  const service = new CupGroupsService(
    transaction as never,
    authorization as never,
    { execute } as never,
    audit as never
  );
  return { service, transaction };
}

describe('CupGroupsService', () => {
  it('generates a reproducible balanced proposal and supersedes the previous draft', async () => {
    const { service, transaction } = harness();

    const first = await service.generate('admin-1', 'league-1', 'cup-1', {
      expectedCompetitionVersion: 2,
      randomSeed: 20261003
    }, 'groups-1');
    const second = await service.generate('admin-1', 'league-1', 'cup-1', {
      expectedCompetitionVersion: 2,
      randomSeed: 17
    }, 'groups-2');
    const counts = Object.values(first.rows.reduce<Record<string, number>>((result, row) => {
      result[row.suggestedGroupCode] = (result[row.suggestedGroupCode] ?? 0) + 1;
      return result;
    }, {})).sort((left, right) => right - left);

    expect(counts).toEqual([4, 3, 3]);
    expect(new Set(first.rows.map((row) => row.participantId)).size).toBe(10);
    expect(second.version).toBe(2);
    expect(transaction.cupGroupProposal.updateMany).toHaveBeenLastCalledWith({
      where: { competitionId: 'cup-1', status: 'DRAFT' },
      data: { status: 'SUPERSEDED' }
    });
  });

  it('rejects group generation before registration is closed', async () => {
    const { service, transaction } = harness();
    transaction.competition.findUnique.mockResolvedValueOnce({
      ...(await transaction.competition.findUnique()), status: 'REGISTRATION_OPEN'
    });

    await expect(service.generate('admin-1', 'league-1', 'cup-1', {
      expectedCompetitionVersion: 2,
      randomSeed: 1
    }, 'groups-closed')).rejects.toMatchObject({ code: 'CUP_GROUP_GENERATION_NOT_ALLOWED' });
    expect(transaction.cupGroupProposal.create).not.toHaveBeenCalled();
  });

  it('confirms a balanced adjusted proposal into official draft stages and memberships', async () => {
    const { service, transaction } = confirmationHarness();

    const result = await service.confirm('admin-1', 'league-1', 'cup-1', {
      proposalId: 'proposal-1',
      expectedCompetitionVersion: 2,
      overrides: [
        { participantId: 'participant-1', targetGroupCode: 'GROUP_B', reason: '交换小组' },
        { participantId: 'participant-5', targetGroupCode: 'GROUP_A', reason: '交换小组' }
      ]
    }, 'confirm-groups');

    expect(result.stages).toEqual([
      expect.objectContaining({ stageCode: 'GROUP_A', participantCount: 4 }),
      expect.objectContaining({ stageCode: 'GROUP_B', participantCount: 4 })
    ]);
    expect(transaction.stageParticipant.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ stageId: 'stage-GROUP_B', participantId: 'participant-1' }),
        expect.objectContaining({ stageId: 'stage-GROUP_A', participantId: 'participant-5' })
      ])
    });
    expect(transaction.cupGroupProposal.updateMany).toHaveBeenCalledWith({
      where: { id: 'proposal-1', status: 'DRAFT' }, data: { status: 'CONFIRMED' }
    });
  });

  it('rejects an override that makes group sizes differ by more than one', async () => {
    const { service, transaction } = confirmationHarness();

    await expect(service.confirm('admin-1', 'league-1', 'cup-1', {
      proposalId: 'proposal-1',
      expectedCompetitionVersion: 2,
      overrides: [{ participantId: 'participant-1', targetGroupCode: 'GROUP_B', reason: '错误调整' }]
    }, 'confirm-unbalanced')).rejects.toMatchObject({ code: 'CUP_GROUPS_UNBALANCED' });
    expect(transaction.competitionStage.create).not.toHaveBeenCalled();
  });
});
