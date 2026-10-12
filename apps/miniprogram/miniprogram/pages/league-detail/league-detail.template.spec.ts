import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const markup = readFileSync(resolve(process.cwd(), 'miniprogram/pages/league-detail/index.wxml'), 'utf8')

describe('league detail module cards', () => {
  it('renders player auctions in the same grid as the standard workspace modules', () => {
    const gridStart = markup.indexOf('<view class="module-grid">')
    const auctionPosition = markup.indexOf('球员拍卖')
    const gridMarkup = markup.slice(gridStart, auctionPosition + '球员拍卖'.length)

    expect(gridStart).toBeGreaterThan(-1)
    expect(gridMarkup).toContain('workspaceModules')
    expect(gridMarkup).toContain('module-tile')
    expect(markup).not.toContain('class="auction-entry"')
  })

  it('prioritizes member actions and removes duplicated season navigation', () => {
    const page = readFileSync(resolve(process.cwd(), 'miniprogram/pages/league-detail/index.ts'), 'utf8')
    const workspacePosition = markup.indexOf('class="workspace-card"')
    const overviewPosition = markup.indexOf('class="season-overview-card"')

    expect(markup).toContain('class="league-hero league-hero--compact"')
    expect(markup).toContain('class="season-switcher"')
    expect(workspacePosition).toBeGreaterThan(-1)
    expect(overviewPosition).toBeGreaterThan(workspacePosition)
    expect(markup).toContain('class="entry-card entry-card--priority"')
    expect(markup).toContain('class="entry-card entry-card--secondary"')
    expect(markup).not.toContain('class="progress-card"')
    expect(markup).not.toContain('class="season-picker-card"')
    expect(markup).not.toContain('class="season-board"')
    expect(markup).not.toContain('class="standings-entry')
    expect(page).not.toContain('enterCurrentSeason()')
    expect(page).not.toContain('openStandings()')
  })
})
