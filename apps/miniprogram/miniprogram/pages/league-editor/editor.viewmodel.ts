import type { GamePlatform, LeagueDetail } from '@efm/contracts'

export type LeagueForm = {
  name: string
  shortName: string
  description: string
  logoUrl: string
  defaultPlatform: GamePlatform
  defaultServerRegion: string
  defaultSuperCapacity: string
  defaultChampionCapacity: string
  defaultPromotionCount: string
}

export function buildLeagueForm(league: LeagueDetail | null): LeagueForm {
  return {
    name: league?.name ?? '',
    shortName: league?.shortName ?? '',
    description: league?.description ?? '',
    logoUrl: league?.logoUrl ?? '',
    defaultPlatform: league?.defaultPlatform ?? 'MOBILE',
    defaultServerRegion: league?.defaultServerRegion ?? 'GLOBAL',
    defaultSuperCapacity: String(league?.defaultSuperCapacity ?? 23),
    defaultChampionCapacity: String(league?.defaultChampionCapacity ?? 18),
    defaultPromotionCount: String(league?.defaultPromotionCount ?? 4),
  }
}

export function leagueEditorMode(league: LeagueDetail | null) {
  return league
    ? { title: '编辑联赛规则', action: '保存联赛' }
    : { title: '创建长期联赛', action: '创建联赛' }
}

export function isLeagueFormValid(form: LeagueForm): boolean {
  const capacities = [form.defaultSuperCapacity, form.defaultChampionCapacity, form.defaultPromotionCount]
  return Boolean(
    form.name.trim()
      && form.shortName.trim()
      && form.defaultServerRegion.trim()
      && capacities.every((value) => Number.isInteger(Number(value)) && Number(value) > 0),
  )
}

export function leagueEditorErrorMessage(code: string): { message: string; refresh: boolean } {
  if (code === 'VERSION_CONFLICT') {
    return { message: '联赛规则已在其他端更新，已为你重新加载', refresh: true }
  }
  if (code === 'FORBIDDEN') return { message: '你没有管理这个联赛的权限', refresh: false }
  return { message: '保存失败，请检查填写内容后重试', refresh: false }
}
