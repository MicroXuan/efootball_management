import type { GameAccountResponse, GamePlatform } from '@efm/contracts'

type AccountFormShape = {
  platform: GamePlatform | ''
  serverRegion: string
  gamerTag: string
}

export function sortAccounts(accounts: readonly GameAccountResponse[]): GameAccountResponse[] {
  return [...accounts].sort((left, right) => Number(right.isDefault) - Number(left.isDefault))
}

export function platformLabel(platform: GamePlatform): string {
  const labels: Record<GamePlatform, string> = {
    MOBILE: '移动端',
    PLAYSTATION: 'PlayStation',
    XBOX: 'Xbox',
    STEAM: 'Steam',
  }
  return labels[platform]
}

export function isAccountFormValid(form: AccountFormShape): boolean {
  return Boolean(form.platform && form.serverRegion.trim() && form.gamerTag.trim())
}

export function accountErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    GAME_ACCOUNT_ALREADY_BOUND: '这个游戏账号已被绑定，请检查平台、区服和玩家名',
    GAME_ACCOUNT_IN_USE: '该账号正在被赛事使用，暂时不能删除',
    GAME_ACCOUNT_NOT_FOUND: '未找到这个游戏账号，它可能已被删除',
    VALIDATION_FAILED: '填写内容不完整，请检查后重试',
    NETWORK_ERROR: '网络连接失败，请稍后重试',
  }
  return messages[code] ?? '操作未完成，请稍后重试'
}

export function deleteConfirmation(account: Pick<GameAccountResponse, 'platform' | 'gamerTag'>): {
  title: string
  content: string
} {
  return {
    title: '删除游戏账号？',
    content: `将删除 ${platformLabel(account.platform)} 账号「${account.gamerTag}」，此操作无法撤销。`,
  }
}
