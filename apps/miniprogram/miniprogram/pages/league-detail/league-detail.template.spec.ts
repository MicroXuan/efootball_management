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
})
