const BYE = '__BYE__';

export type ScheduledPairing = {
  roundNumber: number;
  matchNumber: number;
  homeParticipantId: string;
  awayParticipantId: string;
  pairingKey: string;
};

function lexicalOrder(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function generateRoundRobin(participantIds: readonly string[]): ScheduledPairing[] {
  if (participantIds.length < 2) return [];

  let rotation = [...participantIds].sort(lexicalOrder);
  if (rotation.length % 2 === 1) rotation.push(BYE);

  const pairings: ScheduledPairing[] = [];
  const roundCount = rotation.length - 1;
  const matchesPerRound = rotation.length / 2;
  let matchNumber = 1;

  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    for (let pairingIndex = 0; pairingIndex < matchesPerRound; pairingIndex += 1) {
      const left = rotation[pairingIndex]!;
      const right = rotation[rotation.length - 1 - pairingIndex]!;
      if (left === BYE || right === BYE) continue;

      const reverseHome = (roundIndex + pairingIndex) % 2 === 1;
      const homeParticipantId = reverseHome ? right : left;
      const awayParticipantId = reverseHome ? left : right;
      pairings.push({
        roundNumber: roundIndex + 1,
        matchNumber,
        homeParticipantId,
        awayParticipantId,
        pairingKey: [left, right].sort(lexicalOrder).join(':')
      });
      matchNumber += 1;
    }

    rotation = [rotation[0]!, rotation.at(-1)!, ...rotation.slice(1, -1)];
  }

  return pairings;
}
