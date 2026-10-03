import type { CompetitionDetail, GameAccountResponse, StandingsSnapshotResponse } from '@efm/contracts'

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

export function standingsEmpty(standings: StandingsSnapshotResponse): boolean {
  return standings.version === 0 || standings.rows.length === 0
}

export function isCupCompetition(competition: Pick<CompetitionDetail, 'competitionType'>): boolean {
  return competition.competitionType === 'GROUP_KNOCKOUT_CUP'
    || competition.competitionType === 'KNOCKOUT_CUP'
}
