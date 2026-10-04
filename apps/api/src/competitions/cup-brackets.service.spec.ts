import { describe, expect, it, jest } from '@jest/globals';
import { CupBracketsService } from './cup-brackets.service.js';

const createdAt = new Date('2026-10-03T12:00:00.000Z');

function dependencies(transaction: Record<string, unknown>) {
  const execute = jest.fn(async (
    _actor: string,
    _operation: string,
    _key: string,
    work: (client: typeof transaction) => Promise<unknown>
  ) => work(transaction));
  const authorization = {
    requireLeagueAccess: jest.fn(async () => ({ id: 'admin-1' }))
  };
  const audit = { record: jest.fn(async () => undefined) };
  return {
    service: new CupBracketsService(
      authorization as never,
      { execute } as never,
      audit as never
    ),
    audit
  };
}

function proposalStore() {
  let version = 0;
  let pairingSequence = 0;
  const rounds: Array<Record<string, unknown>> = [];
  const pairings: Array<Record<string, unknown>> = [];
  return {
    rounds,
    pairings,
    cupBracketProposal: {
      findFirst: jest.fn(async () => version ? { version } : null),
      updateMany: jest.fn(async () => ({ count: version ? 1 : 0 })),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        version = data.version as number;
        return { id: `proposal-${version}`, status: 'DRAFT', createdAt, ...data };
      }),
      findUnique: jest.fn()
    },
    cupBracketRound: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const round = { id: `round-${String(data.roundNumber)}`, createdAt, ...data };
        rounds.push(round);
        return round;
      })
    },
    cupBracketPairing: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        pairingSequence += 1;
        const pairing = {
          id: `pairing-${pairingSequence}`,
          matchId: null,
          winnerParticipantId: null,
          createdAt,
          updatedAt: createdAt,
          ...data
        };
        pairings.push(pairing);
        return pairing;
      })
    }
  };
}

describe('CupBracketsService', () => {
  it('generates a versioned pure-knockout proposal with explicit byes and future round sources', async () => {
    const store = proposalStore();
    const competition = {
      id: 'cup-1', competitionType: 'KNOCKOUT_CUP', status: 'REGISTRATION_CLOSED', version: 4,
      season: { leagueId: 'league-1' }, cupConfig: {},
      participants: Array.from({ length: 5 }, (_, index) => ({ id: `participant-${index + 1}` })),
      stages: []
    };
    const transaction = {
      $queryRaw: jest.fn(async () => []),
      competition: { findUnique: jest.fn(async () => competition) },
      ...store
    };
    const { service } = dependencies(transaction);

    const result = await service.generate('admin-1', 'league-1', 'cup-1', {
      expectedCompetitionVersion: 4,
      randomSeed: 23
    }, 'draw-1');

    expect(result.bracketSize).toBe(8);
    expect(result.rounds.map((round) => round.stageCode)).toEqual([
      'QUARTER_FINAL', 'SEMI_FINAL', 'FINAL'
    ]);
    expect(result.rounds[0]?.pairings.filter((pairing) => pairing.byeParticipantId)).toHaveLength(3);
    expect(result.rounds[1]?.pairings[0]).toEqual(expect.objectContaining({
      homeSourcePairingId: result.rounds[0]?.pairings[0]?.id,
      awaySourcePairingId: result.rounds[0]?.pairings[1]?.id
    }));
  });

  it('uses completed, unambiguous group standings as seeded knockout qualifiers', async () => {
    const store = proposalStore();
    const group = (code: string, offset: number) => ({
      id: `stage-${code}`, stageCode: code, status: 'PUBLISHED',
      matches: [{ id: `match-${code}`, officialResultVersionId: `result-${code}` }],
      standingsSnapshots: [{
        rows: [1, 2, 3, 4].map((rank) => ({
          participantId: `participant-${offset + rank}`,
          rank,
          tiePending: false
        }))
      }]
    });
    const transaction = {
      $queryRaw: jest.fn(async () => []),
      competition: { findUnique: jest.fn(async () => ({
        id: 'cup-1', competitionType: 'GROUP_KNOCKOUT_CUP', status: 'IN_PROGRESS', version: 7,
        season: { leagueId: 'league-1' }, cupConfig: { qualifiersPerGroup: 2 }, participants: [],
        stages: [group('GROUP_A', 0), group('GROUP_B', 4)]
      })) },
      ...store
    };
    const { service } = dependencies(transaction);

    const result = await service.generate('admin-1', 'league-1', 'cup-1', {
      expectedCompetitionVersion: 7,
      randomSeed: 11
    }, 'draw-groups');

    const firstRound = result.rounds[0]!.pairings;
    expect(firstRound).toHaveLength(2);
    expect(firstRound.every((pairing) => pairing.homeParticipantId && pairing.awayParticipantId)).toBe(true);
    expect(firstRound.every((pairing) => {
      const homeGroup = Number(pairing.homeParticipantId?.split('-')[1]) <= 4 ? 'A' : 'B';
      const awayGroup = Number(pairing.awayParticipantId?.split('-')[1]) <= 4 ? 'A' : 'B';
      return homeGroup !== awayGroup;
    })).toBe(true);
  });

  it('rejects a group draw while a group match or qualification tie is unresolved', async () => {
    const store = proposalStore();
    const transaction = {
      $queryRaw: jest.fn(async () => []),
      competition: { findUnique: jest.fn(async () => ({
        id: 'cup-1', competitionType: 'GROUP_KNOCKOUT_CUP', status: 'IN_PROGRESS', version: 2,
        season: { leagueId: 'league-1' }, cupConfig: { qualifiersPerGroup: 2 }, participants: [],
        stages: [{
          id: 'group-a', stageCode: 'GROUP_A', status: 'PUBLISHED',
          matches: [{ id: 'unfinished', officialResultVersionId: null }],
          standingsSnapshots: [{ rows: [{ participantId: 'p1', rank: 1, tiePending: true }] }]
        }]
      })) },
      ...store
    };
    const { service } = dependencies(transaction);

    await expect(service.generate('admin-1', 'league-1', 'cup-1', {
      expectedCompetitionVersion: 2,
      randomSeed: 1
    }, 'draw-blocked')).rejects.toMatchObject({ code: 'CUP_GROUP_STAGE_INCOMPLETE' });
    expect(store.cupBracketProposal.create).not.toHaveBeenCalled();
  });

  it('confirms a draft bracket, publishes only the first round, creates matches, and advances byes', async () => {
    const firstPairings = [{
      id: 'pairing-1', pairingNumber: 1,
      homeParticipantId: 'participant-1', awayParticipantId: null,
      homeSourcePairingId: null, awaySourcePairingId: null,
      byeParticipantId: 'participant-1', matchId: null, winnerParticipantId: null
    }, {
      id: 'pairing-2', pairingNumber: 2,
      homeParticipantId: 'participant-2', awayParticipantId: 'participant-3',
      homeSourcePairingId: null, awaySourcePairingId: null,
      byeParticipantId: null, matchId: null, winnerParticipantId: null
    }];
    const proposal = {
      id: 'proposal-1', competitionId: 'cup-1', version: 1, status: 'DRAFT',
      algorithmVersion: 'cup-bracket-v1', randomSeed: 9, bracketSize: 4, createdAt,
      rounds: [{
        id: 'round-1', roundNumber: 1, stageCode: 'SEMI_FINAL', displayName: '半决赛', pairings: firstPairings
      }, {
        id: 'round-2', roundNumber: 2, stageCode: 'FINAL', displayName: '决赛', pairings: [{
          id: 'pairing-3', pairingNumber: 1,
          homeParticipantId: null, awayParticipantId: null,
          homeSourcePairingId: 'pairing-1', awaySourcePairingId: 'pairing-2',
          byeParticipantId: null, matchId: null, winnerParticipantId: null
        }]
      }]
    };
    let matchSequence = 0;
    const transaction = {
      $queryRaw: jest.fn(async () => []),
      competition: {
        findUnique: jest.fn(async () => ({
          id: 'cup-1', competitionType: 'KNOCKOUT_CUP', status: 'REGISTRATION_CLOSED', version: 5,
          season: { leagueId: 'league-1' },
          participants: ['participant-1', 'participant-2', 'participant-3'].map((id) => ({ id })),
          stages: []
        })),
        updateMany: jest.fn(async () => ({ count: 1 }))
      },
      cupBracketProposal: {
        findUnique: jest.fn(async () => proposal),
        updateMany: jest.fn(async () => ({ count: 1 }))
      },
      competitionStage: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: `stage-${String(data.stageCode)}`, ...data
        }))
      },
      stageParticipant: { createMany: jest.fn(async () => ({ count: 3 })) },
      competitionMatch: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          matchSequence += 1;
          return { id: `match-${matchSequence}`, ...data };
        })
      },
      cupBracketPairing: {
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
          ...[...firstPairings, ...proposal.rounds[1]!.pairings].find(({ id }) => id === where.id),
          ...data
        }))
      }
    };
    const { service } = dependencies(transaction);

    const result = await service.confirm('admin-1', 'league-1', 'cup-1', {
      proposalId: 'proposal-1',
      expectedCompetitionVersion: 5
    }, 'confirm-draw');

    expect(transaction.competitionStage.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({ stageCode: 'SEMI_FINAL', status: 'PUBLISHED' })
    });
    expect(transaction.competitionStage.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({ stageCode: 'FINAL', status: 'DRAFT' })
    });
    expect(transaction.competitionMatch.create).toHaveBeenCalledTimes(1);
    expect(transaction.cupBracketPairing.update).toHaveBeenCalledWith({
      where: { id: 'pairing-1' },
      data: { winnerParticipantId: 'participant-1' }
    });
    expect(result.status).toBe('CONFIRMED');
  });
});
