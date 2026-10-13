import type { CompetitionDetail, CompetitionMatchResponse, CupBracketView, CupRegistrationResponse, GameAccountResponse, SeasonEntryResponse, StandingsSnapshotResponse } from '@efm/contracts'

export type EligibleAccount = GameAccountResponse & {
  eligible: boolean
  disabledReason: string
}

export function eligibleAccounts(accounts: GameAccountResponse[], competition: CompetitionDetail): EligibleAccount[] {
  return accounts.map((account) => {
    const platformMatches = account.platform === competition.platform
    const regionMatches = account.serverRegion === competition.serverRegion
    return {
      ...account,
      eligible: platformMatches && regionMatches,
      disabledReason: !platformMatches ? '平台不符合赛事要求' : !regionMatches ? '区服不符合赛事要求' : '',
    }
  })
}

export function registrationAvailability(competition: CompetitionDetail, eligibleAccountCount: number) {
  if (competition.status !== 'REGISTRATION_OPEN') return { enabled: false, reason: '当前不在报名时间内' }
  if (competition.participantCount >= competition.participantLimit) return { enabled: false, reason: '报名名额已满' }
  if (competition.currentRegistration && ['PENDING', 'APPROVED'].includes(competition.currentRegistration.status)) {
    return { enabled: false, reason: competition.currentRegistration.status === 'PENDING' ? '报名正在审核' : '已经报名' }
  }
  if (eligibleAccountCount === 0) return { enabled: false, reason: '没有符合平台和区服要求的游戏账号' }
  return { enabled: true, reason: '' }
}

export function cupRegistrationAvailability(
  competition: CompetitionDetail,
  seasonEntry: Pick<SeasonEntryResponse, 'status'> | null,
  registration: Pick<CupRegistrationResponse, 'status'> | null,
) {
  if (competition.status !== 'REGISTRATION_OPEN') return { enabled: false, reason: '当前不在报名时间内' }
  if (competition.participantCount >= competition.participantLimit) return { enabled: false, reason: '报名名额已满' }
  if (registration?.status === 'APPROVED') return { enabled: false, reason: '球队已经报名' }
  if (!seasonEntry) return { enabled: false, reason: '你还没有本赛季的参赛球队' }
  if (seasonEntry.status !== 'APPROVED') return { enabled: false, reason: '赛季球队尚未通过审核' }
  return { enabled: true, reason: '' }
}

export function standingsEmpty(standings: StandingsSnapshotResponse): boolean {
  return standings.version === 0 || standings.rows.length === 0
}

export function isCupCompetition(competition: Pick<CompetitionDetail, 'competitionType'>): boolean {
  return competition.competitionType === 'GROUP_KNOCKOUT_CUP'
    || competition.competitionType === 'KNOCKOUT_CUP'
}

export type CupScheduleSection = {
  stageId: string
  stageCode: CompetitionMatchResponse['stageCode']
  stageDisplayName: string
  matches: CompetitionMatchResponse[]
}

export function cupScheduleSections(matches: CompetitionMatchResponse[]): CupScheduleSection[] {
  const sections = new Map<string, CupScheduleSection>()
  for (const match of matches) {
    const section = sections.get(match.stageId) ?? {
      stageId: match.stageId,
      stageCode: match.stageCode,
      stageDisplayName: match.stageDisplayName ?? '杯赛阶段',
      matches: [],
    }
    section.matches.push(match)
    sections.set(match.stageId, section)
  }
  return [...sections.values()]
}

export type BracketBoardRound = CupBracketView['rounds'][number] & {
  topOffset: number
  pairingGap: number
}

export function bracketBoardRounds(bracket: CupBracketView | null): BracketBoardRound[] {
  if (!bracket) return []
  const pairingHeight = 132
  const baseGap = 16
  const unit = pairingHeight + baseGap
  return bracket.rounds.map((round, index) => {
    const span = 2 ** index
    return {
      ...round,
      topOffset: unit * (span - 1) / 2,
      pairingGap: unit * span - pairingHeight,
    }
  })
}
