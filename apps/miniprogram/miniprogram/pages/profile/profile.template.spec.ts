import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('profile template', () => {
  it('presents the three high-frequency destinations as one compact action hub', () => {
    const template = readFileSync(resolve(process.cwd(), 'miniprogram/pages/profile/index.wxml'), 'utf8')

    expect(template).toContain('class="quick-actions"')
    expect(template).toContain('bindtap="openMyMatches"')
    expect(template).toContain('bindtap="openPlayerAuctions"')
    expect(template).toContain('bindtap="openFavorites"')
    expect(template).not.toContain('class="favorites-entry" bindtap="openFavorites"')
  })

  it('keeps the WeChat bot entry behind a disabled feature flag', () => {
    const template = readFileSync(resolve(process.cwd(), 'miniprogram/pages/profile/index.wxml'), 'utf8')

    expect(template).toContain('wx:if="{{features.wechatBot}}"')
    expect(template).toContain('绑定群机器人')
  })
})
