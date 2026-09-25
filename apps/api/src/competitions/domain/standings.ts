import type { CompetitionTieBreaker } from '@efm/contracts';

export type StandingsParticipant = {
  id: string;
  admissionSequence: number;
  displayName: string;
};

export type StandingsResult = {
  homeParticipantId: string;
  awayParticipantId: string;
  homeScore: number;
  awayScore: number;
};

export type StandingsRules = {
  winPoints: number;
  drawPoints: number;
  lossPoints: number;
  tieBreakers: readonly CompetitionTieBreaker[];
};

export type StandingTieBreakValues = {
  totalPoints: number;
  headToHeadPoints: number;
  headToHeadGoalDifference: number;
  totalGoalDifference: number;
  totalGoals: number;
  wins: number;
};

export type CalculatedStanding = {
  participantId: string;
  displayName: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  basePoints: number;
  adjustmentPoints: number;
  totalPoints: number;
  rank: number;
  tiePending: boolean;
  tieBreakValues: StandingTieBreakValues;
};

type WorkingStanding = CalculatedStanding & {
  admissionSequence: number;
};

function applyResult(
  home: WorkingStanding,
  away: WorkingStanding,
  result: StandingsResult,
  rules: StandingsRules
): void {
  home.played += 1;
  away.played += 1;
  home.goalsFor += result.homeScore;
  home.goalsAgainst += result.awayScore;
  away.goalsFor += result.awayScore;
  away.goalsAgainst += result.homeScore;

  if (result.homeScore > result.awayScore) {
    home.wins += 1;
    away.losses += 1;
    home.basePoints += rules.winPoints;
    away.basePoints += rules.lossPoints;
  } else if (result.homeScore < result.awayScore) {
    away.wins += 1;
    home.losses += 1;
    away.basePoints += rules.winPoints;
    home.basePoints += rules.lossPoints;
  } else {
    home.draws += 1;
    away.draws += 1;
    home.basePoints += rules.drawPoints;
    away.basePoints += rules.drawPoints;
  }
}

function tieValue(row: WorkingStanding, tieBreaker: CompetitionTieBreaker): number {
  switch (tieBreaker) {
    case 'TOTAL_POINTS': return row.totalPoints;
    case 'HEAD_TO_HEAD_POINTS': return row.tieBreakValues.headToHeadPoints;
    case 'HEAD_TO_HEAD_GOAL_DIFFERENCE': return row.tieBreakValues.headToHeadGoalDifference;
    case 'TOTAL_GOAL_DIFFERENCE': return row.goalDifference;
    case 'TOTAL_GOALS': return row.goalsFor;
    case 'WINS': return row.wins;
  }
}

function compareSportingRows(
  left: WorkingStanding,
  right: WorkingStanding,
  tieBreakers: readonly CompetitionTieBreaker[]
): number {
  for (const tieBreaker of tieBreakers) {
    const difference = tieValue(right, tieBreaker) - tieValue(left, tieBreaker);
    if (difference !== 0) return difference;
  }
  return 0;
}

function populateMiniTable(
  group: WorkingStanding[],
  officialResults: readonly StandingsResult[],
  rules: StandingsRules
): void {
  const memberIds = new Set(group.map(({ participantId }) => participantId));
  const miniRows = new Map(group.map((row) => [row.participantId, {
    points: 0,
    goalsFor: 0,
    goalsAgainst: 0
  }]));

  for (const result of officialResults) {
    if (!memberIds.has(result.homeParticipantId) || !memberIds.has(result.awayParticipantId)) continue;
    const home = miniRows.get(result.homeParticipantId)!;
    const away = miniRows.get(result.awayParticipantId)!;
    home.goalsFor += result.homeScore;
    home.goalsAgainst += result.awayScore;
    away.goalsFor += result.awayScore;
    away.goalsAgainst += result.homeScore;
    if (result.homeScore > result.awayScore) {
      home.points += rules.winPoints;
      away.points += rules.lossPoints;
    } else if (result.homeScore < result.awayScore) {
      away.points += rules.winPoints;
      home.points += rules.lossPoints;
    } else {
      home.points += rules.drawPoints;
      away.points += rules.drawPoints;
    }
  }

  for (const row of group) {
    const mini = miniRows.get(row.participantId)!;
    row.tieBreakValues.headToHeadPoints = mini.points;
    row.tieBreakValues.headToHeadGoalDifference = mini.goalsFor - mini.goalsAgainst;
  }
}

export function calculateStandings(
  participants: readonly StandingsParticipant[],
  officialResults: readonly StandingsResult[],
  rules: StandingsRules
): CalculatedStanding[] {
  const rows = participants.map<WorkingStanding>((participant) => ({
    participantId: participant.id,
    displayName: participant.displayName,
    admissionSequence: participant.admissionSequence,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    basePoints: 0,
    adjustmentPoints: 0,
    totalPoints: 0,
    rank: 0,
    tiePending: false,
    tieBreakValues: {
      totalPoints: 0,
      headToHeadPoints: 0,
      headToHeadGoalDifference: 0,
      totalGoalDifference: 0,
      totalGoals: 0,
      wins: 0
    }
  }));
  const byParticipantId = new Map(rows.map((row) => [row.participantId, row]));

  for (const result of officialResults) {
    const home = byParticipantId.get(result.homeParticipantId);
    const away = byParticipantId.get(result.awayParticipantId);
    if (!home || !away) continue;
    applyResult(home, away, result, rules);
  }

  for (const row of rows) {
    row.goalDifference = row.goalsFor - row.goalsAgainst;
    row.totalPoints = row.basePoints + row.adjustmentPoints;
    row.tieBreakValues.totalPoints = row.totalPoints;
    row.tieBreakValues.totalGoalDifference = row.goalDifference;
    row.tieBreakValues.totalGoals = row.goalsFor;
    row.tieBreakValues.wins = row.wins;
  }

  const pointsGroups = new Map<number, WorkingStanding[]>();
  for (const row of rows) {
    const group = pointsGroups.get(row.totalPoints) ?? [];
    group.push(row);
    pointsGroups.set(row.totalPoints, group);
  }
  for (const group of pointsGroups.values()) populateMiniTable(group, officialResults, rules);

  rows.sort((left, right) => {
    const sportingOrder = compareSportingRows(left, right, rules.tieBreakers);
    if (sportingOrder !== 0) return sportingOrder;
    return left.admissionSequence - right.admissionSequence
      || left.participantId.localeCompare(right.participantId);
  });

  for (const [index, row] of rows.entries()) {
    const tiedWithAnother = rows.some((candidate) => (
      candidate !== row && compareSportingRows(row, candidate, rules.tieBreakers) === 0
    ));
    row.tiePending = tiedWithAnother;
    row.rank = index > 0 && compareSportingRows(rows[index - 1]!, row, rules.tieBreakers) === 0
      ? rows[index - 1]!.rank
      : index + 1;
  }

  return rows.map(({ admissionSequence: _, ...row }) => row);
}
