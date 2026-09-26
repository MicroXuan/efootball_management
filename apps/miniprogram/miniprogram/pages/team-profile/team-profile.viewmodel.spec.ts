import type { GameAccountResponse, TeamProfileResponse } from '@efm/contracts'
import { describe, expect, it } from 'vitest'
import {
  buildTeamProfileForm,
  isTeamProfileFormValid,
  selectedAccount,
  teamProfileErrorMessage,
  teamProfileMode,
  teamProfileSavedMessage,
} from './team-profile.viewmodel'

const account = (overrides: Partial<GameAccountResponse> = {}): GameAccountResponse => ({
  id: 'account-1',
  platform: 'MOBILE',
  serverRegion: 'GLOBAL',
  gamerTag: 'Dust',
  gameUid: null,
  isDefault: false,
  verificationStatus: 'UNVERIFIED',
  createdAt: '2026-09-26T12:00:00.000Z',
  updatedAt: '2026-09-26T12:00:00.000Z',
  ...overrides,
})

const profile = (overrides: Partial<TeamProfileResponse> = {}): TeamProfileResponse => ({
  id: 'profile-1',
  ownerUserId: 'user-1',
  name: '上海申花',
  shortName: '申花',
  logoUrl: null,
  defaultGameAccountId: 'account-1',
  status: 'ACTIVE',
  version: 1,
  createdAt: '2026-09-26T12:00:00.000Z',
  updatedAt: '2026-09-26T12:00:00.000Z',
  ...overrides,
})

describe('team profile view model', () => {
  it('requires names and an owned account before saving', () => {
    const accounts = [account()]
    expect(isTeamProfileFormValid({ name: '', shortName: '申花', logoUrl: '', defaultGameAccountId: 'account-1' }, accounts)).toBe(false)
    expect(isTeamProfileFormValid({ name: '上海申花', shortName: '', logoUrl: '', defaultGameAccountId: 'account-1' }, accounts)).toBe(false)
    expect(isTeamProfileFormValid({ name: '上海申花', shortName: '申花', logoUrl: '', defaultGameAccountId: 'foreign' }, accounts)).toBe(false)
    expect(isTeamProfileFormValid({ name: '上海申花', shortName: '申花', logoUrl: '', defaultGameAccountId: 'account-1' }, accounts)).toBe(true)
  })

  it('selects the current account and defaults new profiles to the default account', () => {
    const accounts = [account(), account({ id: 'account-2', gamerTag: 'KC', isDefault: true })]
    expect(selectedAccount(accounts, 'account-2')?.gamerTag).toBe('KC')
    expect(buildTeamProfileForm(null, accounts).defaultGameAccountId).toBe('account-2')
    expect(buildTeamProfileForm(profile(), accounts)).toMatchObject({
      name: '上海申花',
      shortName: '申花',
      defaultGameAccountId: 'account-1',
    })
  })

  it('derives create and edit presentation from profile presence', () => {
    expect(teamProfileMode(null)).toEqual({ mode: 'create', title: '建立球队档案', action: '创建球队' })
    expect(teamProfileMode(profile())).toEqual({ mode: 'edit', title: '维护球队档案', action: '保存变更' })
    expect(teamProfileSavedMessage(null)).toBe('球队已建立')
    expect(teamProfileSavedMessage(profile())).toBe('变更已保存')
  })

  it('maps profile conflicts to actionable Chinese copy', () => {
    expect(teamProfileErrorMessage('TEAM_PROFILE_ALREADY_EXISTS')).toBe('球队档案已存在，重新加载后可继续编辑')
    expect(teamProfileErrorMessage('GAME_ACCOUNT_NOT_OWNED')).toBe('所选游戏账号已不属于你，请重新选择')
    expect(teamProfileErrorMessage('VERSION_CONFLICT')).toBe('球队资料已在其他端更新，请刷新后重试')
  })
})
