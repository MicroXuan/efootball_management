import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const miniRoot = resolve(process.cwd(), 'miniprogram')

function source(relativePath: string): string {
  return readFileSync(resolve(miniRoot, relativePath), 'utf8')
}

describe('mini-program image source integration', () => {
  it('renders entity artwork from the resolved local source', () => {
    expect(source('components/entity-artwork/index.wxml')).toContain('src="{{displaySrc}}"')
    const controller = source('components/entity-artwork/index.ts')
    expect(controller).toContain("from '../../services/image-source'")
    expect(controller).toContain('cacheImageSource(')
    expect(controller).toContain('downloadCloud: (options) => wx.cloud.downloadFile(options)')
  })

  it('renders the league banner from the resolved local source', () => {
    expect(source('pages/leagues/index.wxml')).toContain("background-image: url('{{bannerDisplayUrl}}')")
    const controller = source('pages/leagues/index.ts')
    expect(controller).toContain("from '../../services/image-source'")
    expect(controller).toContain('cacheImageSource(')
    expect(controller).not.toContain('wx.getImageInfo')
  })

  it('renders transparent league logos on a light surface', () => {
    expect(source('pages/leagues/index.wxml')).toContain('surface="light"')
    expect(source('pages/league-detail/index.wxml')).toContain('surface="light"')
    expect(source('components/entity-artwork/index.wxml')).toContain('artwork--{{surface}}')
    expect(source('components/entity-artwork/index.wxss')).toContain('.artwork--light')
  })
})
