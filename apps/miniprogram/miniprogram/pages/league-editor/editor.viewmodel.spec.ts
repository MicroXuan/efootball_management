import type { LeagueDetail } from '@efm/contracts'
import { describe, expect, it } from 'vitest'
import { buildLeagueForm, isLeagueFormValid, leagueEditorErrorMessage, leagueEditorMode } from './editor.viewmodel'

const league = (): LeagueDetail => ({
  id: 'league-1', name: 'CELL传奇联赛', shortName: 'CELL', description: '长期联赛', logoUrl: null,
  status: 'ACTIVE', defaultPlatform: 'MOBILE', defaultServerRegion: 'GLOBAL', defaultSuperCapacity: 23,
  defaultChampionCapacity: 18, defaultPromotionCount: 4, featuredSeason: null, version: 2,
  createdAt: '2026-09-26T00:00:00.000Z', updatedAt: '2026-09-26T00:00:00.000Z',
  capabilities: { canManage: true, canCreateSeason: true },
})

describe('league editor view model', () => {
  it('starts new leagues with the approved default capacities', () => {
    expect(buildLeagueForm(null)).toMatchObject({
      defaultSuperCapacity: '23', defaultChampionCapacity: '18', defaultPromotionCount: '4',
    })
  })

  it('loads persisted defaults in edit mode and validates required fields', () => {
    const form = buildLeagueForm(league())
    expect(leagueEditorMode(league())).toEqual({ title: '编辑联赛规则', action: '保存联赛' })
    expect(form).toMatchObject({ name: 'CELL传奇联赛', defaultSuperCapacity: '23' })
    expect(isLeagueFormValid(form)).toBe(true)
    expect(isLeagueFormValid({ ...form, defaultServerRegion: ' ' })).toBe(false)
  })

  it('marks version conflicts as a refresh action', () => {
    expect(leagueEditorErrorMessage('VERSION_CONFLICT')).toEqual({
      message: '联赛规则已在其他端更新，已为你重新加载',
      refresh: true,
    })
  })
})
