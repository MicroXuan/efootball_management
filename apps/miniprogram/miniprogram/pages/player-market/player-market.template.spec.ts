import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const miniRoot = resolve(process.cwd(), 'miniprogram')

describe('native player market pages', () => {
  it('registers market list and detail without adding a bottom tab', () => {
    const app = JSON.parse(readFileSync(resolve(miniRoot, 'app.json'), 'utf8')) as { pages: string[]; tabBar: { list: Array<{ pagePath: string }> } }
    expect(app.pages).toContain('pages/player-market/index')
    expect(app.pages).toContain('pages/player-market-detail/index')
    expect(app.tabBar.list.map((item) => item.pagePath)).not.toContain('pages/player-market/index')
  })

  it('renders four internal views and ownership filters', () => {
    const markup = readFileSync(resolve(miniRoot, 'pages/player-market/index.wxml'), 'utf8')
    const styles = readFileSync(resolve(miniRoot, 'pages/player-market/index.wxss'), 'utf8')
    expect(markup).toContain('找球员')
    expect(markup).toContain('公开申请')
    expect(markup).toContain('成交公告')
    expect(markup).toContain('我的申请')
    expect(markup).toContain('位置')
    expect(markup).toContain('归属')
    expect(markup).toContain('<view class="view-tab {{view === \'players\' ? \'is-active\' : \'\'}}"')
    expect(markup).not.toContain('<button class="view-tab')
    expect(styles).toMatch(/grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/)
    expect(styles).toMatch(/\.view-tabs\s*\{[^}]*width:\s*100%;[^}]*box-sizing:\s*border-box;/s)
    expect(styles).toMatch(/\.view-tab\s*\{[^}]*min-width:\s*0;[^}]*box-sizing:\s*border-box;[^}]*justify-self:\s*stretch;/s)
    expect(styles).toMatch(/\.view-tab\.is-active\s*\{[^}]*box-shadow:\s*inset 0 0 0 2rpx #8fbd35;/s)
    expect(styles).not.toContain('.view-tab.is-active:before')
    expect(styles).not.toContain('.view-tab.is-active{color:#f4f7f8;border-bottom:5rpx solid #b6f13a}')
  })

  it('uses compact search type and renders best-card artwork in player results', () => {
    const markup = readFileSync(resolve(miniRoot, 'pages/player-market/index.wxml'), 'utf8')
    const styles = readFileSync(resolve(miniRoot, 'pages/player-market/index.wxss'), 'utf8')
    const config = JSON.parse(readFileSync(resolve(miniRoot, 'pages/player-market/index.json'), 'utf8')) as { usingComponents?: Record<string, string> }

    expect(config.usingComponents?.['entity-artwork']).toBe('/components/entity-artwork/index')
    expect(markup).toContain('src="{{item.portraitUrl}}"')
    expect(markup).toContain('fallback="{{item.portraitFallback}}"')
    expect(markup).toContain('shape="portrait"')
    expect(markup).toContain('<view class="search-button" bindtap="searchPlayers" role="button">搜索</view>')
    expect(markup).not.toContain('<button bindtap="searchPlayers">搜索</button>')
    expect(styles).toMatch(/\.search-row input\s*\{[^}]*box-sizing:\s*border-box;[^}]*font-size:\s*18rpx;/s)
    expect(styles).toMatch(/\.search-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) 132rpx;/s)
    expect(styles).toMatch(/\.search-button\s*\{[^}]*height:\s*64rpx;/s)
  })

  it('keeps the market introduction and filters compact so results begin higher', () => {
    const styles = readFileSync(resolve(miniRoot, 'pages/player-market/index.wxss'), 'utf8')

    expect(styles).toMatch(/\.page-shell\s*\{[^}]*padding:\s*18rpx 24rpx 120rpx;/s)
    expect(styles).toMatch(/\.market-head\s*\{[^}]*padding:\s*20rpx 22rpx;/s)
    expect(styles).toMatch(/\.page-title\s*\{[^}]*font-size:\s*38rpx;/s)
    expect(styles).toMatch(/\.view-tabs\s*\{[^}]*margin:\s*14rpx 0;/s)
    expect(styles).toMatch(/\.filters,[\s\S]*?\.state-card\s*\{[^}]*padding:\s*16rpx;/s)
    expect(styles).toMatch(/\.card-list\s*\{[^}]*margin-top:\s*14rpx;/s)
  })

  it('renders explicit normal/forced confirmation and amend/withdraw controls', () => {
    const markup = readFileSync(resolve(miniRoot, 'pages/player-market-detail/index.wxml'), 'utf8')
    expect(markup).toContain('最高报价不代表必然获批')
    expect(markup).toContain('原球队无需同意')
    expect(markup).toContain('修改报价')
    expect(markup).toContain('撤回申请')
    expect(markup).toContain('disabled="{{submitting}}"')
  })
})
