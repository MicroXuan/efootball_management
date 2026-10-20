import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const markup = readFileSync(resolve(process.cwd(), 'miniprogram/pages/league-detail/index.wxml'), 'utf8')

describe('league detail module cards', () => {
  it('keeps league navigation free of task reminders', () => {
    const page = readFileSync(resolve(process.cwd(), 'miniprogram/pages/league-detail/index.ts'), 'utf8')

    expect(markup).not.toContain('当前联赛待办')
    expect(markup).not.toContain('class="workspace-todo"')
    expect(markup).not.toContain('bindtap="openActionCenter"')
    expect(markup).not.toContain('项提醒')
    expect(markup).not.toContain('directory-entry')
    expect(page).not.toContain('loadTransactionAttention')
    expect(page).not.toContain('openActionCenter')
    expect(page).not.toContain('leagueAttentionCount')
  })

  it('keeps the compact hero below the runtime status bar', () => {
    const page = readFileSync(resolve(process.cwd(), 'miniprogram/pages/league-detail/index.ts'), 'utf8')

    expect(markup).toContain('style="padding-top: calc({{statusBarHeight}}px + 26rpx);"')
    expect(page).toContain('statusBarHeight: wx.getSystemInfoSync().statusBarHeight')
  })

  it('renders auctions and nominations through the standard module cards', () => {
    const gridStart = markup.indexOf('<view class="workspace-groups">')
    const gridMarkup = markup.slice(gridStart)

    expect(gridStart).toBeGreaterThan(-1)
    expect(gridMarkup).toContain('workspaceModuleGroups')
    expect(gridMarkup).toContain('module-grid')
    expect(gridMarkup).toContain('module-tile')
    expect(gridMarkup).toContain('wx:for="{{group.modules}}"')
    expect(markup).not.toContain('class="auction-entry"')
    expect(markup).not.toContain('class="module-tile is-auction"')
    expect(markup).not.toContain('bindtap="openPlayerNominations"')
  })

  it('uses always-open group headings and one-tap cards', () => {
    expect(markup).toContain('class="workspace-group__head"')
    expect(markup).toContain('bindtap="onWorkspaceModuleTap"')
    expect(markup).not.toMatch(/class="workspace-group__head"[^>]*bindtap=/)
  })

  it('prioritizes member actions and removes duplicated season navigation', () => {
    const page = readFileSync(resolve(process.cwd(), 'miniprogram/pages/league-detail/index.ts'), 'utf8')
    const qualificationPosition = markup.indexOf('class="entry-card entry-card--priority"')
    const workspacePosition = markup.indexOf('class="workspace-card"')
    const overviewPosition = markup.indexOf('class="season-overview-card"')

    expect(markup).toContain('class="league-hero league-hero--compact"')
    expect(markup).toContain('class="league-hero__main"')
    expect(markup).toContain('{{leagueEditionLabel}} · 联赛中心')
    expect(markup).not.toContain('{{league.shortName}} · 联赛中心')
    expect(markup).toContain('class="season-switcher"')
    expect(qualificationPosition).toBeGreaterThan(-1)
    expect(workspacePosition).toBeGreaterThan(-1)
    expect(workspacePosition).toBeGreaterThan(qualificationPosition)
    expect(overviewPosition).toBeGreaterThan(workspacePosition)
    expect(markup.match(/我的资格/g)).toHaveLength(1)
    expect(markup).not.toContain('entry-card--secondary')
    expect(markup).toContain('workspaceModuleGroups')
    expect(markup).toContain('{{group.label}}')
    expect(markup).not.toContain('class="progress-card"')
    expect(markup).not.toContain('class="season-picker-card"')
    expect(markup).not.toContain('class="season-board"')
    expect(markup).not.toContain('class="standings-entry')
    expect(page).not.toContain('enterCurrentSeason()')
    expect(page).not.toContain('openStandings()')
  })

  it('uses a stable drawn chevron for season switching', () => {
    expect(markup).toContain('class="season-switcher__action"')
    expect(markup).toContain('class="season-switcher__chevron"')
    expect(markup).not.toContain('切换⌄')
  })

  it('opens fixtures and calendar from separate sibling controls', () => {
    const page = readFileSync(resolve(process.cwd(), 'miniprogram/pages/league-detail/index.ts'), 'utf8')

    expect(markup).toContain('class="workspace-metric workspace-metric--schedule"')
    expect(markup).toMatch(/class="schedule-link[^"\n]*"[^>]*bindtap="openFixtures"/)
    expect(markup).toMatch(/class="schedule-link[^"\n]*"[^>]*bindtap="openSeasonCalendar"/)
    expect(markup).toContain('全部赛程')
    expect(markup).toContain('赛季日程')
    expect(markup).not.toContain('下一场')
    expect(markup).toContain('{{workspaceView.rankNotice}}')
    expect(page).not.toContain("upcomingOnly=1")
    expect(page).not.toContain('loadActionCenterSummary')
    expect(page).toContain('leagueId=')
    expect(page).toContain('seasonId=')
  })

  it('shows the team identity once and gives rank and fixtures distinct dashboard cards', () => {
    expect(markup).not.toContain('class="workspace-title">{{workspaceView.teamName}}')
    expect(markup).toContain('class="workspace-title">赛季工作台</text>')
    expect(markup).toContain('class="workspace-metric workspace-metric--rank"')
    expect(markup).toContain('class="workspace-schedule-links"')
  })
})
