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
    expect(markup).toContain('转会新闻')
    expect(markup).toContain('item.source.logoUrl')
    expect(markup).toContain('item.source.numberCopy')
    expect(markup).toContain('item.target.logoUrl')
    expect(markup).toContain('item.target.numberCopy')
    expect(markup).toContain('wx:if="{{item.source.numberCopy}}"')
    expect(markup).toContain('wx:if="{{item.target.numberCopy}}"')
    expect(markup).toContain('继续下滑加载更多 · 每次 30 条')
    expect(markup).toContain('bindtap="backToTop"')
    expect(markup).not.toContain('bindtap="loadMoreAnnouncements"')
    expect(markup).toContain('item.valuationLabel')
    expect(markup).toContain('item.salaryLabel')
    expect(markup).toContain('item.profileFacts.length')
    expect(markup).toContain('{{fact.label}} {{fact.value}}')
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
    expect(markup).toContain('directHttps="{{true}}"')
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
    const styles = readFileSync(resolve(miniRoot, 'pages/player-market-detail/index.wxss'), 'utf8')
    expect(markup).toContain('最高报价不代表必然获批')
    expect(markup).toContain('player.profileFacts.length')
    expect(markup).toContain('原球队无需同意')
    expect(markup).toContain('修改报价')
    expect(markup).toContain('撤回申请')
    expect(markup).toContain('myApplication.reviewReason')
    expect(markup).toContain('reapply.actionLabel')
    expect(markup).toContain('disabled="{{submitting || !reapply.enabled}}"')
    expect(markup).toContain('disabled="{{submitting}}"')
    expect(markup.match(/class="button-grid efm-equal-tabs"/g)).toHaveLength(2)
    expect(styles).toContain('grid-template-columns:repeat(2,minmax(0,1fr));width:100%;')
    expect(styles).toContain('margin-top:22rpx;overflow:hidden}.button-grid>button{width:100%;min-width:0;max-width:100%')
    expect(styles).toContain('.amount-field input{min-width:0;flex:1;')
    expect(styles).toContain('.player-name{min-width:0;flex:1;')
  })

  it('lets users select the displayed forced-offer notice for manual copying', () => {
    const markup = readFileSync(resolve(miniRoot, 'pages/player-market-detail/index.wxml'), 'utf8')
    expect(markup).toMatch(/<text\s+class="forced-copy-text"\s+user-select="true">\{\{forcedCopyText\}\}<\/text>/)
    expect(markup).toContain('bindtap="copyForcedOffer"')
  })
  it('shows salary only in league market pages and keeps it separate from the bid amount', () => {
    const list = readFileSync(resolve(miniRoot, 'pages/player-market/index.wxml'), 'utf8')
    const detail = readFileSync(resolve(miniRoot, 'pages/player-market-detail/index.wxml'), 'utf8')
    const externalCard = readFileSync(resolve(miniRoot, 'pages/player-card-detail/index.wxml'), 'utf8')
    expect(list).toContain('{{item.salaryHeading}} {{item.salaryLabel}}')
    expect(detail).toContain('本队工资帽')
    expect(detail).toContain('签入后预计占用')
    expect(detail).toContain('申请金额与工资分开计算')
    expect(detail).toContain('以审核时结果为准')
    expect(externalCard).not.toMatch(/工资|salary/i)
  })
})
