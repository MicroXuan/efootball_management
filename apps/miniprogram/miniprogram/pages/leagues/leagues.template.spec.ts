import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const markup = readFileSync(resolve(__dirname, 'index.wxml'), 'utf8')
const page = readFileSync(resolve(__dirname, 'index.ts'), 'utf8')

describe('league banner tab lifecycle', () => {
  it('unmounts the banner image while the tab page is hidden', () => {
    expect(markup).toContain('bannerVisible && bannerDisplayUrl && !bannerFailed')
    expect(markup).not.toContain('lazy-load="{{true}}"')
    expect(page).toMatch(/onHide\(\)\s*\{[^}]*bannerVisible:\s*false/s)
    expect(page).toMatch(/onShow\(\)\s*\{[^}]*bannerVisible:\s*true/s)
  })
})
