import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const miniRoot = resolve(process.cwd(), 'miniprogram')

describe('native player auction pages', () => {
  it('registers the list and shareable room routes', () => {
    const app = JSON.parse(readFileSync(resolve(miniRoot, 'app.json'), 'utf8')) as { pages: string[] }
    expect(app.pages).toContain('pages/player-auctions/index')
    expect(app.pages).toContain('pages/auction-room/index')
  })

  it('renders identity, countdown, bid controls, reconnect state, history, queue, and explicit sharing', () => {
    const markup = readFileSync(resolve(miniRoot, 'pages/auction-room/index.wxml'), 'utf8')
    expect(markup).toContain('当前出价球队')
    expect(markup).toContain('{{teamName}}')
    expect(markup).toContain('{{countdown}}')
    expect(markup).toContain('type="number"')
    expect(markup).toContain('最低有效价')
    expect(markup).toContain('{{item.label}}')
    expect(markup).toContain('核对并出价')
    expect(markup).toContain('{{amountHint}}')
    expect(markup).toContain('disabled="{{!canSubmit}}"')
    expect(markup).toContain('正在重新连接')
    expect(markup).toContain('有效出价记录')
    expect(markup).toContain('后续球员')
    expect(markup).toContain('open-type="share"')
    expect(markup).not.toMatch(/修改资金|写入阵容|自动签约/)
  })

  it('preserves direct-card navigation, login return, and timer cleanup', () => {
    const room = readFileSync(resolve(miniRoot, 'pages/auction-room/index.ts'), 'utf8')
    const login = readFileSync(resolve(miniRoot, 'pages/login/index.ts'), 'utf8')
    expect(room).toContain('options.batchId')
    expect(room).toContain("'/pages/auction-room/index?batchId='")
    expect(room).toContain("'/pages/login/index?redirect='")
    expect(room).toMatch(/onHide\(\)[\s\S]*stopPolling/)
    expect(room).toMatch(/onUnload\(\)[\s\S]*stopPolling/)
    expect(login).toContain('options.redirect')
    expect(login).toContain('decodeURIComponent')
    expect(login).toContain('wx.redirectTo')
  })

  it('requires a native confirmation before sending a bid', () => {
    const room = readFileSync(resolve(miniRoot, 'pages/auction-room/index.ts'), 'utf8')
    expect(room).toContain('wx.showModal')
    expect(room).toContain("confirmText: '确认出价'")
  })
})
