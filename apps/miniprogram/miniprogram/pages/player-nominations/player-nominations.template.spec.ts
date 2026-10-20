import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const markup = readFileSync(resolve(__dirname, 'index.wxml'), 'utf8')
const styles = readFileSync(resolve(__dirname, 'index.wxss'), 'utf8')

it('shows remaining team slots, free-player search, and withdrawal', () => {
  expect(markup).toContain('{{workspace.remainingSlots}}')
  expect(markup).toContain('bindtap="searchPlayers"')
  expect(markup).toContain('bindtap="nominate"')
  expect(markup).toContain('bindtap="withdraw"')
  expect(markup).toContain('管理员汇总候选后再安排拍卖')
  expect(markup).toContain('fit="contain"')
  expect(markup).toContain('自动加点 AT {{item.overallLabel}}')
  expect(markup).toContain('{{item.clubLabel}}')
  expect(markup).toContain('{{item.playerName}}')
  expect(markup).toContain('aria-disabled="{{busy || item.nominated || workspace.remainingSlots < 1}}"')
})

it('keeps nomination actions inside narrow cards and formats the deadline', () => {
  expect(markup).toContain('截止：{{deadlineLabel}}')
  expect(markup).not.toContain('{{workspace.window.endsAt}}')
  expect(markup).toMatch(/<view[^>]*class="search-button[^>]*role="button"/)
  expect(markup).toMatch(/<view[^>]*class="withdraw-action[^>]*role="button"/)
  expect(markup).toMatch(/<view[^>]*class="nominate-button[^>]*role="button"/)
  expect(styles).toMatch(/\.search\s*\{[^}]*display:\s*flex/)
  expect(styles).toMatch(/\.search input\s*\{[^}]*flex:\s*1/)
  expect(markup).toContain('<scroll-view wx:else scroll-y="{{nominationCards.length > 3}}"')
  expect(markup).toContain('src="{{item.portraitUrl}}"')
  expect(markup).toContain('{{item.clubLabel}} · {{item.nationalityLabel}}')
  expect(markup).toContain('{{item.cardName}} · {{item.position}} · AT {{item.overallLabel}}')
  expect(styles).toMatch(/\.nomination-list\.is-scrollable\s*\{[^}]*height:\s*470rpx/)
  expect(styles).toMatch(/\.nomination-info\s*\{[^}]*min-width:\s*0;[^}]*flex:\s*1/)
})

it('renders no-window as information and reserves retry for real failures', () => {
  const empty = markup.match(/wx:elif="\{\{state === 'empty'\}\}"([\s\S]*?)<block wx:else>/)?.[1]
  const error = markup.match(/wx:elif="\{\{state === 'error'\}\}"([\s\S]*?)<view wx:elif="\{\{state === 'empty'\}\}"/)?.[1]
  expect(empty).toContain('本赛季尚未设置提名期')
  expect(empty).not.toContain('bindtap="loadPage"')
  expect(error).toContain('bindtap="loadPage"')
})
