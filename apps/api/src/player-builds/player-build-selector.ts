export type BestCardCandidate = {
  autoBuildId: string;
  playerCardId: string;
  externalId: string;
  algorithmVersion: string;
  maxOverall: number;
  releaseDate: Date | null;
};

export type BestCardSelectionReason = {
  algorithmVersion: string;
  ordering: readonly [
    'maxOverall:desc',
    'releaseDate:desc:nulls-last',
    'externalId:asc'
  ];
  candidateCount: number;
  winner: {
    externalId: string;
    maxOverall: number;
    releaseDate: string | null;
  };
};

export type BestCardSelection = BestCardCandidate & {
  selectionReason: BestCardSelectionReason;
};

const ordering = [
  'maxOverall:desc',
  'releaseDate:desc:nulls-last',
  'externalId:asc'
] as const;

function descendingNullable(left: number | null, right: number | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

function compare(left: BestCardCandidate, right: BestCardCandidate): number {
  return right.maxOverall - left.maxOverall
    || descendingNullable(left.releaseDate?.valueOf() ?? null, right.releaseDate?.valueOf() ?? null)
    || left.externalId.localeCompare(right.externalId, 'en-US');
}

export function selectBestCard(builds: readonly BestCardCandidate[]): BestCardSelection | null {
  if (builds.length === 0) return null;
  const winner = [...builds].sort(compare)[0]!;
  return {
    ...winner,
    selectionReason: {
      algorithmVersion: winner.algorithmVersion,
      ordering,
      candidateCount: builds.length,
      winner: {
        externalId: winner.externalId,
        maxOverall: winner.maxOverall,
        releaseDate: winner.releaseDate?.toISOString().slice(0, 10) ?? null
      }
    }
  };
}
