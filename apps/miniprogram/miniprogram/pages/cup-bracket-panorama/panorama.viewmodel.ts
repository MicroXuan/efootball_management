import type { CompetitionParticipantSummary, CupBracketView } from '@efm/contracts'
import { bracketBoardRounds } from '../competition-detail/detail.viewmodel'

type BracketParticipant = NonNullable<CupBracketView['rounds'][number]['pairings'][number]['homeParticipant']>

export type PanoramaParticipant = (BracketParticipant & {
  teamNumber?: number | null
  teamLogoUrl?: string | null
  isMine: boolean
}) | null

export type PanoramaPairing = Omit<CupBracketView['rounds'][number]['pairings'][number], 'homeParticipant' | 'awayParticipant'> & {
  homeParticipant: PanoramaParticipant
  awayParticipant: PanoramaParticipant
  connectorOffset: number
  connectorHeight: number
  isMyMatch: boolean
}

export type PanoramaRound = Omit<ReturnType<typeof bracketBoardRounds>[number], 'pairings'> & {
  pairings: PanoramaPairing[]
}

export type PanoramaBoard = {
  width: number
  height: number
  rounds: PanoramaRound[]
  routeSections: PanoramaRouteSection[]
  myRouteSections: PanoramaRouteSection[]
  hasMyTeam: boolean
}

export type PanoramaRouteSection = {
  key: 'upper' | 'lower' | 'final'
  title: string
  subtitle: string
  rounds: PanoramaRound[]
}

function enrichParticipant(
  participant: CupBracketView['rounds'][number]['pairings'][number]['homeParticipant'],
  participantById: Map<string, CompetitionParticipantSummary>,
  myTeamName: string,
): PanoramaParticipant {
  if (!participant) return null
  const profile = participantById.get(participant.id)
  const displayName = profile?.teamName ?? participant.displayName
  return {
    ...participant,
    displayName,
    teamNumber: profile?.teamNumber ?? null,
    teamLogoUrl: profile?.teamLogoUrl ?? null,
    isMine: Boolean(myTeamName) && displayName === myTeamName,
  }
}

function routeHalf(rounds: PanoramaRound[], upper: boolean): PanoramaRound[] {
  return rounds.map((round) => {
    const splitAt = Math.ceil(round.pairings.length / 2)
    return { ...round, pairings: upper ? round.pairings.slice(0, splitAt) : round.pairings.slice(splitAt) }
  }).filter((round) => round.pairings.length > 0)
}

function routeSections(rounds: PanoramaRound[]): PanoramaRouteSection[] {
  const finalRound = rounds[rounds.length - 1]
  if (!finalRound) return []
  if (rounds.length === 1) {
    return [{ key: 'final', title: '冠军战', subtitle: '最后一场，决出冠军', rounds: [finalRound] }]
  }
  const leadRounds = rounds.slice(0, -1)
  return [
    { key: 'upper', title: '上半区', subtitle: '胜者沿此路线晋级', rounds: routeHalf(leadRounds, true) },
    { key: 'lower', title: '下半区', subtitle: '胜者沿此路线晋级', rounds: routeHalf(leadRounds, false) },
    { key: 'final', title: '冠军战', subtitle: '两条路线在这里会合', rounds: [finalRound] },
  ]
}

function focusedRouteSections(sections: PanoramaRouteSection[]): PanoramaRouteSection[] {
  return sections.map((section) => ({
    ...section,
    rounds: section.rounds.map((round) => ({
      ...round,
      pairings: round.pairings.filter((pairing) => pairing.isMyMatch),
    })).filter((round) => round.pairings.length > 0),
  })).filter((section) => section.rounds.length > 0)
}

export function panoramaBoard(
  bracket: CupBracketView | null,
  participants: CompetitionParticipantSummary[],
  myTeamName = '',
): PanoramaBoard {
  if (!bracket) return { width: 0, height: 0, rounds: [], routeSections: [], myRouteSections: [], hasMyTeam: false }
  const participantById = new Map(participants.map((participant) => [participant.id, participant]))
  const rounds = bracketBoardRounds(bracket).map((round, roundIndex, allRounds) => ({
    ...round,
    pairings: round.pairings.map((pairing, pairingIndex) => {
      const connectorHeight = (132 + round.pairingGap) / 2
      return {
        ...pairing,
        homeParticipant: enrichParticipant(pairing.homeParticipant, participantById, myTeamName),
        awayParticipant: enrichParticipant(pairing.awayParticipant, participantById, myTeamName),
        connectorOffset: roundIndex === allRounds.length - 1 ? 0 : connectorHeight * (pairingIndex % 2 === 0 ? 1 : -1),
        connectorHeight,
        isMyMatch: false,
      }
    }).map((pairing) => ({
      ...pairing,
      isMyMatch: Boolean(pairing.homeParticipant?.isMine || pairing.awayParticipant?.isMine),
    })),
  }))
  const firstRound = rounds[0]
  const firstRoundHeight = firstRound
    ? firstRound.topOffset + firstRound.pairings.length * 132 + Math.max(0, firstRound.pairings.length - 1) * firstRound.pairingGap
    : 0
  const sections = routeSections(rounds)
  return {
    width: Math.max(1120, rounds.length * 410 + Math.max(0, rounds.length - 1) * 130 + 160),
    height: Math.max(760, firstRoundHeight + 210),
    rounds,
    routeSections: sections,
    myRouteSections: focusedRouteSections(sections),
    hasMyTeam: rounds.some((round) => round.pairings.some((pairing) => pairing.isMyMatch)),
  }
}
