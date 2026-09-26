import {
  calculateStandings,
  type StandingsParticipant,
  type StandingsResult,
  type StandingsRules
} from './standings.js';

const participants: StandingsParticipant[] = [
  { id: 'A', admissionSequence: 1, displayName: 'A' },
  { id: 'B', admissionSequence: 2, displayName: 'B' },
  { id: 'C', admissionSequence: 3, displayName: 'C' },
  { id: 'D', admissionSequence: 4, displayName: 'D' }
];

const rules: StandingsRules = {
  winPoints: 3,
  drawPoints: 1,
  lossPoints: 0,
  tieBreakers: [
    'TOTAL_POINTS',
    'HEAD_TO_HEAD_POINTS',
    'HEAD_TO_HEAD_GOAL_DIFFERENCE',
    'TOTAL_GOAL_DIFFERENCE',
    'TOTAL_GOALS',
    'WINS'
  ]
};

function result(
  homeParticipantId: string,
  awayParticipantId: string,
  homeScore: number,
  awayScore: number
): StandingsResult {
  return { homeParticipantId, awayParticipantId, homeScore, awayScore };
}

describe('standings calculation', () => {
  it('calculates win, draw, loss, goals, and points totals', () => {
    const rows = calculateStandings(participants.slice(0, 3), [
      result('A', 'B', 3, 0),
      result('A', 'C', 1, 1),
      result('B', 'C', 0, 1)
    ], rules);

    expect(rows.map(({ participantId, played, wins, draws, losses, totalPoints }) => ({
      participantId,
      played,
      wins,
      draws,
      losses,
      totalPoints
    }))).toEqual([
      { participantId: 'A', played: 2, wins: 1, draws: 1, losses: 0, totalPoints: 4 },
      { participantId: 'C', played: 2, wins: 1, draws: 1, losses: 0, totalPoints: 4 },
      { participantId: 'B', played: 2, wins: 0, draws: 0, losses: 2, totalPoints: 0 }
    ]);
  });

  it('uses a three-team mini-table before overall goal difference', () => {
    const rows = calculateStandings(participants, [
      result('A', 'B', 2, 0),
      result('B', 'C', 3, 0),
      result('C', 'A', 1, 0),
      result('A', 'D', 1, 0),
      result('B', 'D', 5, 0),
      result('C', 'D', 10, 0)
    ], rules);

    expect(rows.slice(0, 3).map(({ participantId }) => participantId)).toEqual(['B', 'A', 'C']);
    expect(rows.find(({ participantId }) => participantId === 'C')?.tieBreakValues)
      .toMatchObject({ headToHeadPoints: 3, headToHeadGoalDifference: -2, totalGoalDifference: 8 });
  });

  it('recalculates from replacement official results without mutating either input', () => {
    const originalResults = [result('A', 'B', 1, 0)];
    const correctedResults = [result('A', 'B', 0, 2)];
    const originalSnapshot = structuredClone(originalResults);
    const participantSnapshot = structuredClone(participants.slice(0, 2));

    expect(calculateStandings(participants.slice(0, 2), originalResults, rules)[0]?.participantId).toBe('A');
    expect(calculateStandings(participants.slice(0, 2), correctedResults, rules)[0]?.participantId).toBe('B');
    expect(originalResults).toEqual(originalSnapshot);
    expect(participants.slice(0, 2)).toEqual(participantSnapshot);
  });

  it('returns zeroed deterministic rows before any official result exists', () => {
    const rows = calculateStandings(participants.slice(0, 3), [], rules);

    expect(rows.map(({ participantId }) => participantId)).toEqual(['A', 'B', 'C']);
    expect(rows.every(({ played, totalPoints, tiePending }) => (
      played === 0 && totalPoints === 0 && tiePending
    ))).toBe(true);
  });

  it('preserves an exact tie with shared rank and admission-order display', () => {
    const rows = calculateStandings(participants.slice(0, 2), [result('A', 'B', 1, 1)], rules);

    expect(rows.map(({ participantId, rank, tiePending }) => ({ participantId, rank, tiePending })))
      .toEqual([
        { participantId: 'A', rank: 1, tiePending: true },
        { participantId: 'B', rank: 1, tiePending: true }
      ]);
  });
});
