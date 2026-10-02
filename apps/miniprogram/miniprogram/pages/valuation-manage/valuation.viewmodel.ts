import type { ValuationWorkspace, ValuationWorkspacePlayer } from '@efm/contracts'

export type ValuationPlayerView = ValuationWorkspacePlayer & {
  inputValue: string
  currentValueCopy: string
  allowedRangeCopy: string
  changeState: '首次必填' | '沿用' | '已修改' | '超出范围'
}

export function countdownCopy(workspace: ValuationWorkspace, now = new Date()): string {
  if (workspace.window.state === 'CLOSED') return '申报已关闭，仅可查看'
  const target = workspace.window.state === 'SCHEDULED' ? workspace.window.startsAt : workspace.window.endsAt
  const milliseconds = Math.max(0, Date.parse(target) - now.getTime())
  const days = Math.floor(milliseconds / 86_400_000)
  const hours = Math.floor((milliseconds % 86_400_000) / 3_600_000)
  return workspace.window.state === 'SCHEDULED' ? `距离开放还有 ${days} 天 ${hours} 小时` : `距离关闭还有 ${days} 天 ${hours} 小时`
}

export function valuationPlayerView(player: ValuationWorkspacePlayer): ValuationPlayerView {
  const value = player.draftValueMinor ?? player.currentValueMinor
  const first = player.baseValueMinor === null
  const changed = value !== null && player.currentValueMinor !== null && value !== player.currentValueMinor
  return {
    ...player,
    inputValue: value === null ? '' : String(value),
    currentValueCopy: player.currentValueMinor === null ? '首次申报' : String(player.currentValueMinor),
    allowedRangeCopy: `${player.minimumAllowedMinor} — ${player.maximumAllowedMinor}`,
    changeState: player.exceedsRange ? '超出范围' : first && value === null ? '首次必填' : changed ? '已修改' : '沿用',
  }
}

export function valuationSummary(players: ValuationPlayerView[]) {
  return {
    changedCount: players.filter(({ changeState }) => changeState === '已修改').length,
    unchangedCount: players.filter(({ changeState }) => changeState === '沿用').length,
    exceededCount: players.filter(({ changeState }) => changeState === '超出范围').length,
    missingCount: players.filter(({ inputValue }) => inputValue === '').length,
    complete: players.every(({ inputValue }) => inputValue !== ''),
  }
}

export function validateValuationInput(value: string, player: ValuationWorkspacePlayer): string | null {
  if (!/^\d+$/.test(value)) return '请输入非负整数身价'
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) return '身价数值过大'
  if (parsed < player.minimumAllowedMinor || parsed > player.maximumAllowedMinor) return `允许范围为 ${player.minimumAllowedMinor} — ${player.maximumAllowedMinor}`
  return null
}

export function submissionStateCopy(workspace: ValuationWorkspace): string {
  const status = workspace.submission?.status
  if (!status) return '尚未申报'
  return ({ DRAFT: '草稿已保存', PUBLISHED: '已自动生效', PENDING_REVIEW: '待管理员整批审核', APPROVED: '审核通过', REJECTED: '已驳回，可修改后重新提交' } as const)[status]
}
