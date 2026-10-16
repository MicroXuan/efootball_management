import type { ActionCenterItem, ActionCenterResponse } from '@efm/contracts'
import { describe, expect, it } from 'vitest'
import { actionCenterSourceAttention, actionCenterView } from './action-center.viewmodel'

const task = (id: string, section: ActionCenterItem['section'], leagueId = 'league-1'): ActionCenterItem => ({
  id, version: `2026-10-15T12:0${id.length}:00.000Z`, source: id.startsWith('auction') ? 'AUCTION' : 'TRANSACTION', section,
  league: { id: leagueId, name: leagueId === 'league-1' ? 'CELL 联赛' : '周末联赛' }, seasonId: 'season-1', teamId: 'team-1',
  title: id, detail: `${id}详情`, statusLabel: '状态', occurredAt: `2026-10-15T12:0${id.length}:00.000Z`,
  route: `/pages/player-market/index?id=${id}`,
})

const response: ActionCenterResponse = {
  actionRequiredCount: 1,
  items: [task('requote', 'ACTION_REQUIRED'), task('auction', 'STATUS_UPDATE'), task('approved', 'RECENT'), task('other', 'STATUS_UPDATE', 'league-2')],
}

describe('action center view model', () => {
  it('groups required, update, and recent tasks while marking only changed versions unread', () => {
    const view = actionCenterView(response, { auction: response.items[1]!.version })

    expect(view.required).toHaveLength(1)
    expect(view.updates.map(({ id, unread }) => [id, unread])).toEqual([['auction', false], ['other', true]])
    expect(view.recent[0]).toMatchObject({ id: 'approved', unread: true })
    expect(view.attentionCount).toBe(3)
  })

  it('filters all groups to one league without retaining the global action count', () => {
    const view = actionCenterView(response, {}, 'league-2')

    expect(view.required).toEqual([])
    expect(view.updates.map(({ id }) => id)).toEqual(['other'])
    expect(view.attentionCount).toBe(1)
  })

  it('counts unread or actionable tasks per business source and league', () => {
    expect(actionCenterSourceAttention(response, { auction: response.items[1]!.version })).toEqual({
      TRANSACTION: 3,
      FORCED_TRANSFER: 0,
      AUCTION: 0,
    })
    expect(actionCenterSourceAttention(response, {}, 'league-1')).toEqual({
      TRANSACTION: 2,
      FORCED_TRANSFER: 0,
      AUCTION: 1,
    })
  })
})
