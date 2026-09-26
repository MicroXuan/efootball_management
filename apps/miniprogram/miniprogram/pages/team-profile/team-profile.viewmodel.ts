import type { GameAccountResponse, TeamProfileResponse } from '@efm/contracts'

export type TeamProfileForm = {
  name: string
  shortName: string
  logoUrl: string
  defaultGameAccountId: string
}

export function selectedAccount(
  accounts: readonly GameAccountResponse[],
  accountId: string,
): GameAccountResponse | undefined {
  return accounts.find((account) => account.id === accountId)
}

export function buildTeamProfileForm(
  profile: TeamProfileResponse | null,
  accounts: readonly GameAccountResponse[],
): TeamProfileForm {
  const preferred = accounts.find((account) => account.isDefault) ?? accounts[0]
  return {
    name: profile?.name ?? '',
    shortName: profile?.shortName ?? '',
    logoUrl: profile?.logoUrl ?? '',
    defaultGameAccountId: profile?.defaultGameAccountId ?? preferred?.id ?? '',
  }
}

export function isTeamProfileFormValid(
  form: TeamProfileForm,
  accounts: readonly GameAccountResponse[],
): boolean {
  return Boolean(
    form.name.trim()
    && form.shortName.trim()
    && selectedAccount(accounts, form.defaultGameAccountId),
  )
}

export function teamProfileMode(profile: TeamProfileResponse | null): {
  mode: 'create' | 'edit'
  title: string
  action: string
} {
  return profile
    ? { mode: 'edit', title: '维护球队档案', action: '保存变更' }
    : { mode: 'create', title: '建立球队档案', action: '创建球队' }
}

export function teamProfileSavedMessage(profileBeforeSave: TeamProfileResponse | null): string {
  return profileBeforeSave ? '变更已保存' : '球队已建立'
}

export function teamProfileErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    TEAM_PROFILE_ALREADY_EXISTS: '球队档案已存在，重新加载后可继续编辑',
    TEAM_PROFILE_NOT_FOUND: '未找到球队档案，请刷新后重试',
    GAME_ACCOUNT_NOT_OWNED: '所选游戏账号已不属于你，请重新选择',
    VERSION_CONFLICT: '球队资料已在其他端更新，请刷新后重试',
    VALIDATION_FAILED: '球队名称、简称或账号选择不完整',
    NETWORK_ERROR: '网络连接失败，请稍后重试',
  }
  return messages[code] ?? '球队资料未保存，请稍后重试'
}
