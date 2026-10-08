import type { CurrentUserResponse, MyLeagueTeamSummary } from '@efm/contracts'
import { editionLabel } from '../leagues/leagues.viewmodel'

export type ProfileTeamView = {
  id: string
  teamName: string
  teamNumber: string
  teamLogoUrl: string | null
  teamLogoText: string
  identityCopy: string
  ownerAliasCopy: string
  leagueName: string
  leagueLogoUrl: string | null
  editionLabel: string
  seasonName: string
  rosterCopy: string
}

export type ProfileView = {
  displayName: string
  avatarUrl: string
  region: string
  publicUserNoDisplay: string
  publicUserNoCopy: string
  hasTeams: boolean
  teams: ProfileTeamView[]
}

function publicNumber(value?: string): { display: string; copy: string } {
  if (!value) return { display: '暂无编号', copy: '' }
  const normalized = value.padStart(6, '0').slice(-6)
  return { display: `${normalized.slice(0, 3)} ${normalized.slice(3)}`, copy: normalized }
}

export function profileView(
  user: CurrentUserResponse | null,
  teams: readonly MyLeagueTeamSummary[],
): ProfileView {
  const number = publicNumber(user?.publicUserNo ?? teams[0]?.ownerPublicUserNo)
  const presented = teams.map((team) => ({
    id: team.id,
    teamName: team.name.trim() || '未命名球队',
    teamNumber: team.teamNumber === null ? '—' : String(team.teamNumber),
    teamLogoUrl: team.logoUrl,
    teamLogoText: (team.shortName.trim() || team.name.trim() || '球队').slice(0, 2),
    identityCopy: `${team.teamNumber === null ? '—' : team.teamNumber}-${team.name.trim() || '未命名球队'}`,
    ownerAliasCopy: `（${team.ownerAlias}）`,
    leagueName: team.leagueName.trim() || '未命名联赛',
    leagueLogoUrl: team.leagueLogoUrl,
    editionLabel: editionLabel(team.leagueEdition),
    seasonName: team.currentSeason?.displayName || '暂无当前赛季',
    rosterCopy: `${team.activePlayerCount}/25 人`,
  }))
  return {
    displayName: user?.displayName.trim() || '微信用户',
    avatarUrl: user?.avatarUrl || '',
    region: user?.region?.trim() || '未设置地区',
    publicUserNoDisplay: number.display,
    publicUserNoCopy: number.copy,
    hasTeams: presented.length > 0,
    teams: presented,
  }
}
