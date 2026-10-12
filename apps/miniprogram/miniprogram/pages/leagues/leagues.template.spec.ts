import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const markup = readFileSync(resolve(__dirname, 'index.wxml'), 'utf8')
const page = readFileSync(resolve(__dirname, 'index.ts'), 'utf8')
const styles = readFileSync(resolve(__dirname, 'index.wxss'), 'utf8')
const tabBar = readFileSync(resolve(__dirname, '../../custom-tab-bar/index.ts'), 'utf8')
const tabBarStyles = readFileSync(resolve(__dirname, '../../custom-tab-bar/index.wxss'), 'utf8')

describe('league banner tab lifecycle', () => {
  it('uses a stable view background instead of a composited image node', () => {
    expect(markup).toContain("bannerMode === 'image'")
    expect(markup).toContain("background-image: url('{{bannerDisplayUrl}}')")
    expect(markup).not.toContain('<image')
    expect(page).not.toContain('onHide()')
    expect(page).not.toContain('bannerVisible')
  })

  it('shows the fallback only after banner resolution settles', () => {
    expect(markup).toContain("bannerMode === 'fallback'")
    expect(page).toContain("bannerMode: 'loading'")
    expect(page).toContain('cacheImageSource(')
    expect(page).not.toContain('wx.getImageInfo')
  })

  it('clears the banner layer before switchTab paints the destination page', () => {
    expect(markup).toContain('bannerLayerVisible && bannerMode')
    expect(page).toMatch(/beforeTabLeave\(continueSwitch[^)]*\)[\s\S]*clearBannerBeforeTabSwitch\([\s\S]*bannerLayerVisible:\s*false/)
    expect(page).toMatch(/onShow\(\)[\s\S]*bannerLayerVisible:\s*true/)
    expect(tabBar).toContain('current.beforeTabLeave(navigate)')
    expect(tabBar).toContain('wx.switchTab({ url })')
  })

  it('covers the outgoing league page while keeping the custom tab bar visible', () => {
    expect(markup).toContain('wx:if="{{!bannerLayerVisible}}" class="tab-exit-mask"')
    expect(styles).toMatch(/\.tab-exit-mask\s*{[^}]*position:\s*fixed/)
    expect(styles).toMatch(/\.tab-exit-mask\s*{[^}]*z-index:\s*999/)
    expect(styles).not.toContain('.leagues-page.is-leaving')
    expect(tabBarStyles).toMatch(/\.tabbar-shell\s*{[^}]*z-index:\s*1000/)
  })
})
