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
    expect(markup).toContain('找球员')
    expect(markup).toContain('公开申请')
    expect(markup).toContain('成交公告')
    expect(markup).toContain('我的申请')
    expect(markup).toContain('位置')
    expect(markup).toContain('归属')
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
