import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const markup = readFileSync(resolve(process.cwd(), 'miniprogram/pages/league-detail/index.wxml'), 'utf8')

describe('league detail module cards', () => {
  it('keeps transaction reminders without embedding the action center in a league', () => {
    const page = readFileSync(resolve(process.cwd(), 'miniprogram/pages/league-detail/index.ts'), 'utf8')

    expect(markup).not.toContain('当前联赛待办')
    expect(markup).not.toContain('class="workspace-todo"')
    expect(markup).not.toContain('bindtap="openActionCenter"')
    expect(markup).toContain("marketAttentionCount ? marketAttentionCount + ' 项提醒' : module.stateLabel")
    expect(markup).toContain("auctionAttentionCount ? auctionAttentionCount + ' 项提醒' : '实时开放'")
    expect(page).not.toContain('openActionCenter')
    expect(page).not.toContain('leagueAttentionCount')
  })

  it('keeps the compact hero below the runtime status bar', () => {
    const page = readFileSync(resolve(process.cwd(), 'miniprogram/pages/league-detail/index.ts'), 'utf8')

    expect(markup).toContain('style="padding-top: calc({{statusBarHeight}}px + 26rpx);"')
    expect(page).toContain('statusBarHeight: wx.getSystemInfoSync().statusBarHeight')
  })

  it('renders player auctions in the same grid as the standard workspace modules', () => {
    const gridStart = markup.indexOf('<view class="workspace-groups">')
    const auctionPosition = markup.indexOf('球员拍卖')
    const gridMarkup = markup.slice(gridStart, auctionPosition + '球员拍卖'.length)

    expect(gridStart).toBeGreaterThan(-1)
    expect(gridMarkup).toContain('workspaceModuleGroups')
    expect(gridMarkup).toContain('module-grid')
    expect(gridMarkup).toContain('module-tile')
    expect(markup).not.toContain('class="auction-entry"')
  })

  it('places the player market and player auction beside each other as compact transaction entries', () => {
    expect(markup).toContain("group.key === 'transactions' && module.key === 'playerMarket' && playerAuctionEnabled")
    expect(markup).toContain('class="module-tile is-auction"')
    expect(markup).not.toContain('class="module-tile is-auction is-wide"')
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

  it('opens the current and historical season schedule from the all-fixtures card', () => {
    const page = readFileSync(resolve(process.cwd(), 'miniprogram/pages/league-detail/index.ts'), 'utf8')

    expect(markup).toContain('class="workspace-metric workspace-metric--schedule"')
    expect(markup).toContain('bindtap="openFixtures"')
    expect(markup).toContain('全部赛程')
    expect(markup).toContain('按队伍和状态查找比赛')
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
    expect(markup).toContain('class="workspace-schedule-action"')
  })
})
