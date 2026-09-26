export type MatchAction = 'SUBMIT' | 'CONFIRM' | 'WAIT' | 'DONE'

export function primaryAction(action: MatchAction) {
  const labels: Record<MatchAction, string> = {
    SUBMIT: '提交比分', CONFIRM: '确认对手比分', WAIT: '等待比赛或对手', DONE: '查看结果',
  }
  return { label: labels[action], enabled: action !== 'WAIT' }
}
