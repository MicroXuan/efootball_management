import type { CompetitionParticipantSummary, CupBracketView } from '@efm/contracts'
import { bracketBoardRounds } from '../competition-detail/detail.viewmodel'

type BracketParticipant = NonNullable<CupBracketView['rounds'][number]['pairings'][number]['homeParticipant']>

export type PanoramaParticipant = (BracketParticipant & {
  teamNumber?: number | null
  teamLogoUrl?: string | null
}) | null

export type PanoramaPairing = Omit<CupBracketView['rounds'][number]['pairings'][number], 'homeParticipant' | 'awayParticipant'> & {
  homeParticipant: PanoramaParticipant
  awayParticipant: PanoramaParticipant
  connectorOffset: number
  connectorHeight: number
}

export type PanoramaRound = Omit<ReturnType<typeof bracketBoardRounds>[number], 'pairings'> & {
  pairings: PanoramaPairing[]
}

export type PanoramaBoard = {
  width: number
  height: number
  rounds: PanoramaRound[]
}

function enrichParticipant(
  participant: CupBracketView['rounds'][number]['pairings'][number]['homeParticipant'],
  participantById: Map<string, CompetitionParticipantSummary>,
): PanoramaParticipant {
  if (!participant) return null
  const profile = participantById.get(participant.id)
  return {
    ...participant,
    displayName: profile?.teamName ?? participant.displayName,
    teamNumber: profile?.teamNumber ?? null,
    teamLogoUrl: profile?.teamLogoUrl ?? null,
  }
}

export function panoramaBoard(
  bracket: CupBracketView | null,
  participants: CompetitionParticipantSummary[],
): PanoramaBoard {
  if (!bracket) return { width: 0, height: 0, rounds: [] }
  const participantById = new Map(participants.map((participant) => [participant.id, participant]))
  const rounds = bracketBoardRounds(bracket).map((round, roundIndex, allRounds) => ({
    ...round,
    pairings: round.pairings.map((pairing, pairingIndex) => {
      const connectorHeight = (132 + round.pairingGap) / 2
      return {
        ...pairing,
        homeParticipant: enrichParticipant(pairing.homeParticipant, participantById),
        awayParticipant: enrichParticipant(pairing.awayParticipant, participantById),
        connectorOffset: roundIndex === allRounds.length - 1 ? 0 : connectorHeight * (pairingIndex % 2 === 0 ? 1 : -1),
        connectorHeight,
      }
    }),
  }))
  const firstRound = rounds[0]
  const firstRoundHeight = firstRound
    ? firstRound.topOffset + firstRound.pairings.length * 132 + Math.max(0, firstRound.pairings.length - 1) * firstRound.pairingGap
    : 0
  return {
    width: Math.max(1120, rounds.length * 410 + Math.max(0, rounds.length - 1) * 130 + 160),
    height: Math.max(760, firstRoundHeight + 210),
    rounds,
  }
}
