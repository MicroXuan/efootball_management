import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const markup = readFileSync(resolve(__dirname, 'index.wxml'), 'utf8')
const page = readFileSync(resolve(__dirname, 'index.ts'), 'utf8')

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
})
