import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const markup = readFileSync(resolve(__dirname, 'index.wxml'), 'utf8')
const league = readFileSync(resolve(__dirname, '../league-detail/index.wxml'), 'utf8')

it('offers a month agenda from the league and navigates to fixture schedules', () => {
  expect(league).toContain('bindtap="openSeasonCalendar"')
  expect(markup).toContain('比赛与关键窗口')
  expect(markup).toContain('{{timezoneCopy}}')
  expect(markup).toContain('bindtap="previousMonth"')
  expect(markup).toContain('bindtap="nextMonth"')
  expect(markup).toContain('data-path="{{event.targetPath}}"')
})
