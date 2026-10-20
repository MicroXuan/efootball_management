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
    expect(markup).toContain('确认出价')
    expect(markup).toContain('{{amountHint}}')
    expect(markup).toContain('disabled="{{!canSubmit}}"')
    expect(markup).toContain('正在重新连接')
    expect(markup).toContain('有效出价记录')
    expect(markup).toContain('后续球员')
    expect(markup).toContain('open-type="share"')
    expect(markup).toContain('bindtap="openPlayerCard"')
    expect(markup).toContain('<entity-artwork')
    expect(markup).toMatch(/history-card[\s\S]*bid-dock/)
    expect(markup).toContain('class="bid-history-scroll" scroll-y')
    expect(markup).toContain('{{item.identity}}')
    expect(markup).toContain('{{item.timeLabel}}')
    expect(markup).not.toContain('⭐')
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

  it('submits directly and keeps native buttons inside the bid card', () => {
    const room = readFileSync(resolve(miniRoot, 'pages/auction-room/index.ts'), 'utf8')
    const styles = readFileSync(resolve(miniRoot, 'pages/auction-room/index.wxss'), 'utf8')
    expect(room).not.toContain('wx.showModal')
    expect(styles).toMatch(/\.shortcut-row button\s*\{[^}]*width:100%[^}]*box-sizing:border-box/)
    expect(styles).toMatch(/\.shortcut-row button\[disabled\]\s*\{[^}]*background:/)
    expect(styles).toMatch(/\.bid-button\{[^}]*display:flex[^}]*align-items:center[^}]*justify-content:center/)
    expect(styles).toContain('env(safe-area-inset-bottom)')
    expect(styles).toMatch(/\.bid-history-scroll\{height:/)
  })
})
