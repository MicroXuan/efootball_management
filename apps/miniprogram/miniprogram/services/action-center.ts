import type { ActionCenterItem, ActionCenterResponse } from '@efm/contracts'
import { api } from './api'

const READ_KEY = 'efm.action-center.read.v1'

export type ActionCenterReadVersions = Record<string, string>

export function loadActionCenter(): Promise<ActionCenterResponse> {
  return api.request<ActionCenterResponse>({ path: '/me/action-center' })
}

export function readActionCenterVersions(): ActionCenterReadVersions {
  const value = wx.getStorageSync<unknown>(READ_KEY)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => (
    typeof entry[0] === 'string' && typeof entry[1] === 'string'
  )))
}

export function markActionCenterRead(items: readonly ActionCenterItem[]): ActionCenterReadVersions {
  const next = { ...readActionCenterVersions() }
  for (const item of items) {
    if (item.section !== 'ACTION_REQUIRED') next[item.id] = item.version
  }
  const bounded = Object.fromEntries(Object.entries(next).slice(-400))
  wx.setStorageSync(READ_KEY, bounded)
  return bounded
}

export function actionCenterAttentionCount(
  response: ActionCenterResponse,
  readVersions: ActionCenterReadVersions,
): number {
  const unreadUpdates = response.items.filter((item) => (
    item.section !== 'ACTION_REQUIRED' && readVersions[item.id] !== item.version
  )).length
  return response.actionRequiredCount + unreadUpdates
}
