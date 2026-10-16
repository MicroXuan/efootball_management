import type { ActionCenterItem, ActionCenterResponse } from '@efm/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import {
  actionCenterAttentionCount,
  loadActionCenter,
  markActionCenterRead,
  readActionCenterVersions,
} from './action-center'

const item = (section: ActionCenterItem['section'], version: string): ActionCenterItem => ({
  id: `item-${section}`, version, source: 'TRANSACTION', section,
  league: { id: 'league-1', name: 'CELL 联赛' }, seasonId: 'season-1', teamId: 'team-1',
  title: '申请状态', detail: '劳塔罗', statusLabel: '已更新', occurredAt: version,
  route: '/pages/player-market/index?leagueId=league-1',
})

const response: ActionCenterResponse = {
  actionRequiredCount: 1,
  items: [
    item('ACTION_REQUIRED', '2026-10-15T12:00:00.000Z'),
    item('STATUS_UPDATE', '2026-10-15T12:01:00.000Z'),
    item('RECENT', '2026-10-15T12:02:00.000Z'),
  ],
}

describe('action center service', () => {
  const storage = new Map<string, unknown>()

  beforeEach(() => {
    storage.clear()
    vi.restoreAllMocks()
    vi.stubGlobal('wx', {
      getStorageSync: vi.fn((key: string) => storage.get(key)),
      setStorageSync: vi.fn((key: string, value: unknown) => storage.set(key, value)),
    })
  })

  it('loads the authenticated action-center endpoint', async () => {
    const request = vi.spyOn(api, 'request').mockResolvedValue(response)

    await expect(loadActionCenter()).resolves.toBe(response)
    expect(request).toHaveBeenCalledWith({ path: '/me/action-center' })
  })

  it('counts required actions even after reading while clearing update badges', () => {
    expect(actionCenterAttentionCount(response, {})).toBe(3)

    markActionCenterRead(response.items)
    const versions = readActionCenterVersions()

    expect(versions).toEqual({
      'item-STATUS_UPDATE': '2026-10-15T12:01:00.000Z',
      'item-RECENT': '2026-10-15T12:02:00.000Z',
    })
    expect(actionCenterAttentionCount(response, versions)).toBe(1)
  })

  it('treats malformed local storage as empty read state', () => {
    storage.set('efm.action-center.read.v1', ['invalid'])
    expect(readActionCenterVersions()).toEqual({})
  })
})
