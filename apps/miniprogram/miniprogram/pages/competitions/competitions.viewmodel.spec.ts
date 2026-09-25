import { describe, expect, it } from 'vitest'
import type { CompetitionSummary } from '@efm/contracts'
import { competitionErrorMessage, formatLocalDate, lifecycleLabel, mergeCompetitionPages } from './competitions.viewmodel'

function competition(id: string): CompetitionSummary {
  return {
    id, name: `赛事 ${id}`, description: '', platform: 'MOBILE', serverRegion: 'GLOBAL',
    participantType: 'INDIVIDUAL', format: 'ROUND_ROBIN', status: 'REGISTRATION_OPEN',
    registrationOpensAt: '2026-09-01T00:00:00.000Z', registrationClosesAt: '2026-09-30T12:00:00.000Z',
    startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-01T00:00:00.000Z',
    participantLimit: 16, participantCount: 4, version: 1, activeRuleVersion: 1,
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

describe('competition list view model', () => {
  it('maps lifecycle labels and formats UTC with a supplied local offset', () => {
    expect(lifecycleLabel('REGISTRATION_OPEN')).toBe('报名中')
    expect(lifecycleLabel('IN_PROGRESS')).toBe('进行中')
    expect(lifecycleLabel('COMPLETED')).toBe('已结束')
    expect(formatLocalDate('2026-09-30T12:00:00.000Z', 480)).toBe('09月30日 20:00')
  })

  it('deduplicates cursor pages by competition ID', () => {
    expect(mergeCompetitionPages([competition('a'), competition('b')], [competition('b'), competition('c')])
      .map(({ id }) => id)).toEqual(['a', 'b', 'c'])
  })

  it.each([
    ['VERSION_CONFLICT', '页面信息已更新，请刷新后重试'],
    ['REGISTRATION_CLOSED', '报名已经结束'],
    ['REGISTRATION_FULL', '报名名额已满'],
    ['GAME_ACCOUNT_INELIGIBLE', '游戏账号与赛事平台或区服不匹配'],
    ['NETWORK_ERROR', '网络连接失败，请稍后重试'],
  ])('maps %s to actionable Chinese copy', (code, message) => {
    expect(competitionErrorMessage({ code })).toBe(message)
  })
})
