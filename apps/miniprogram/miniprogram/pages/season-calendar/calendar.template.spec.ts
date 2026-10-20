import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const markup = readFileSync(resolve(__dirname, 'index.wxml'), 'utf8')
const styles = readFileSync(resolve(__dirname, 'index.wxss'), 'utf8')
const league = readFileSync(resolve(__dirname, '../league-detail/index.wxml'), 'utf8')

it('shows a non-interactive seven-column phase preview and an always-visible summary', () => {
  expect(league).toContain('bindtap="openSeasonCalendar"')
  expect(markup).toContain('北京时间')
  expect(markup).toContain('bindtap="previousMonth"')
  expect(markup).toContain('bindtap="nextMonth"')
  expect(markup).toContain('wx:for="{{weeks}}"')
  expect(markup).toContain('wx:for="{{summary}}"')
  expect(markup).not.toContain('bindtap="openItem"')
  expect(markup).not.toContain('比赛与关键窗口')
  expect(styles).toContain('grid-template-columns: repeat(7, minmax(0, 1fr))')
})
