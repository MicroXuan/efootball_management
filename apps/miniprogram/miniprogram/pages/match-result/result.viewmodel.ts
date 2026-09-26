export type ResultForm = { homeScore: string; awayScore: string }

export function validateScore(value: string): number | null {
  if (!/^\d{1,2}$/.test(value)) return null
  const score = Number(value)
  return Number.isInteger(score) && score >= 0 && score <= 99 ? score : null
}

export function resultConflictMessage(code: string) {
  return code === 'VERSION_CONFLICT'
    ? { message: '比赛结果已被更新，请重新确认', reloadRequired: true }
    : { message: code === 'NETWORK_ERROR' ? '网络连接失败，请稍后重试' : '比分操作失败，请稍后重试', reloadRequired: false }
}

export function nextResultForm(form: ResultForm, errorCode: string) {
  const conflict = resultConflictMessage(errorCode)
  return { ...form, errorMessage: conflict.message, reloadRequired: conflict.reloadRequired }
}
