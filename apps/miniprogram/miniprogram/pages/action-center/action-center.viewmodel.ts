import type { ActionCenterItem, ActionCenterResponse } from '@efm/contracts'
import { actionCenterAttentionCount, type ActionCenterReadVersions } from '../../services/action-center'

export type ActionCenterTaskView = ActionCenterItem & {
  marker: string
  sourceLabel: string
  timeLabel: string
  unread: boolean
}

export type ActionCenterView = {
  required: ActionCenterTaskView[]
  updates: ActionCenterTaskView[]
  recent: ActionCenterTaskView[]
  attentionCount: number
  empty: boolean
}

export type ActionCenterSourceAttention = Record<ActionCenterItem['source'], number>

function taskView(item: ActionCenterItem, readVersions: ActionCenterReadVersions): ActionCenterTaskView {
  const source = {
    TRANSACTION: { marker: '交', label: '球员交易' },
    FORCED_TRANSFER: { marker: '强', label: '强报' },
    AUCTION: { marker: '拍', label: '球员拍卖' },
  } as const
  return {
    ...item,
    marker: source[item.source].marker,
    sourceLabel: source[item.source].label,
    timeLabel: item.occurredAt.slice(5, 16).replace('T', ' '),
    unread: item.section !== 'ACTION_REQUIRED' && readVersions[item.id] !== item.version,
  }
}

export function actionCenterView(
  response: ActionCenterResponse,
  readVersions: ActionCenterReadVersions,
  leagueId = '',
): ActionCenterView {
  const items = response.items.filter((item) => !leagueId || item.league.id === leagueId)
  const scoped: ActionCenterResponse = {
    items,
    actionRequiredCount: items.filter(({ section }) => section === 'ACTION_REQUIRED').length,
  }
  const views = items.map((item) => taskView(item, readVersions))
  return {
    required: views.filter(({ section }) => section === 'ACTION_REQUIRED'),
    updates: views.filter(({ section }) => section === 'STATUS_UPDATE'),
    recent: views.filter(({ section }) => section === 'RECENT'),
    attentionCount: actionCenterAttentionCount(scoped, readVersions),
    empty: views.length === 0,
  }
}

export function actionCenterSourceAttention(
  response: ActionCenterResponse,
  readVersions: ActionCenterReadVersions,
  leagueId = '',
): ActionCenterSourceAttention {
  const counts: ActionCenterSourceAttention = { TRANSACTION: 0, FORCED_TRANSFER: 0, AUCTION: 0 }
  for (const item of response.items) {
    if (leagueId && item.league.id !== leagueId) continue
    const deservesAttention = item.section === 'ACTION_REQUIRED' || readVersions[item.id] !== item.version
    if (deservesAttention) counts[item.source] += 1
  }
  return counts
}
