import type { GameAccountResponse } from '@efm/contracts'
import { describe, expect, it } from 'vitest'
import {
  accountErrorMessage,
  deleteConfirmation,
  isAccountFormValid,
  platformLabel,
  sortAccounts,
} from './profile.viewmodel'

const account = (overrides: Partial<GameAccountResponse> = {}): GameAccountResponse => ({
  id: 'account-1',
  platform: 'MOBILE',
  serverRegion: '国服',
  gamerTag: 'Dust',
  gameUid: null,
  isDefault: false,
  verificationStatus: 'UNVERIFIED',
  createdAt: '2026-09-24T12:00:00.000Z',
  updatedAt: '2026-09-24T12:00:00.000Z',
  ...overrides,
})

describe('profile view model', () => {
  it('keeps an empty account list empty', () => {
    expect(sortAccounts([])).toEqual([])
  })

  it('places the default account first without mutating the source list', () => {
    const source = [account(), account({ id: 'account-2', isDefault: true })]

    expect(sortAccounts(source).map(({ id }) => id)).toEqual(['account-2', 'account-1'])
    expect(source.map(({ id }) => id)).toEqual(['account-1', 'account-2'])
  })

  it.each([
    ['MOBILE', '移动端'],
    ['PLAYSTATION', 'PlayStation'],
    ['XBOX', 'Xbox'],
    ['STEAM', 'Steam'],
  ] as const)('formats %s with a user-facing label', (platform, label) => {
    expect(platformLabel(platform)).toBe(label)
  })

  it('requires platform, server region, and gamer tag before save is enabled', () => {
    expect(isAccountFormValid({ platform: 'MOBILE', serverRegion: '', gamerTag: 'Dust' })).toBe(false)
    expect(isAccountFormValid({ platform: 'MOBILE', serverRegion: '国服', gamerTag: '  ' })).toBe(false)
    expect(isAccountFormValid({ platform: 'MOBILE', serverRegion: '国服', gamerTag: 'Dust' })).toBe(true)
  })

  it('maps account conflicts to actionable Chinese copy', () => {
    expect(accountErrorMessage('GAME_ACCOUNT_ALREADY_BOUND')).toBe('这个游戏账号已被绑定，请检查平台、区服和玩家名')
  })

  it('builds a specific destructive confirmation message', () => {
    expect(deleteConfirmation(account({ gamerTag: 'Dust', platform: 'STEAM' }))).toEqual({
      title: '删除游戏账号？',
      content: '将删除 Steam 账号「Dust」，此操作无法撤销。',
    })
  })
})
