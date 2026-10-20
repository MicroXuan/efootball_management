import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const markup = readFileSync(resolve(__dirname, 'index.wxml'), 'utf8')
const league = readFileSync(resolve(__dirname, '../league-detail/index.wxml'), 'utf8')

it('shows remaining team slots, free-player search, and withdrawal from the league entry', () => {
  expect(league).toContain('bindtap="openPlayerNominations"')
  expect(markup).toContain('{{workspace.remainingSlots}}')
  expect(markup).toContain('bindtap="searchPlayers"')
  expect(markup).toContain('bindtap="nominate"')
  expect(markup).toContain('bindtap="withdraw"')
  expect(markup).toContain('管理员汇总候选后再安排拍卖')
})

it('renders no-window as information and reserves retry for real failures', () => {
  const empty = markup.match(/wx:elif="\{\{state === 'empty'\}\}"([\s\S]*?)<block wx:else>/)?.[1]
  const error = markup.match(/wx:elif="\{\{state === 'error'\}\}"([\s\S]*?)<view wx:elif="\{\{state === 'empty'\}\}"/)?.[1]
  expect(empty).toContain('本赛季尚未设置提名期')
  expect(empty).not.toContain('bindtap="loadPage"')
  expect(error).toContain('bindtap="loadPage"')
})
