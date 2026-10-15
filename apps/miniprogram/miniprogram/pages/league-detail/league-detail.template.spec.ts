import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const markup = readFileSync(resolve(process.cwd(), 'miniprogram/pages/league-detail/index.wxml'), 'utf8')

describe('league detail module cards', () => {
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

  it('opens the current and historical season schedule from the next-match card', () => {
    const page = readFileSync(resolve(process.cwd(), 'miniprogram/pages/league-detail/index.ts'), 'utf8')

    expect(markup).toContain('class="workspace-metric workspace-metric--schedule"')
    expect(markup).toContain('bindtap="openUpcomingMatches"')
    expect(markup).toContain('{{workspaceView.rankNotice}}')
    expect(page).not.toContain("upcomingOnly=1")
    expect(page).toContain('leagueId=')
    expect(page).toContain('seasonId=')
  })
})
