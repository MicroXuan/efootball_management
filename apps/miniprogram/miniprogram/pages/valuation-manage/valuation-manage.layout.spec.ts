import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const markup = readFileSync(resolve(__dirname, 'index.wxml'), 'utf8')
const styles = readFileSync(resolve(__dirname, 'index.wxss'), 'utf8')

describe('valuation action bar layout', () => {
  it('shows the team crest alongside a compact heading', () => {
    expect(markup).toContain('class="team-heading"')
    expect(markup).toContain('src="{{teamLogoUrl}}"')
    expect(markup).toContain('fallback="{{teamBadgeFallback}}"')
    expect(styles).toContain('.team-heading .title{min-width:0;flex:1;margin-top:0;overflow-wrap:anywhere}')
  })

  it('keeps both native buttons inside the fixed bar on narrow screens', () => {
    const bar = styles.match(/\.actions\{([^}]*)\}/)?.[1] ?? ''
    const buttons = styles.match(/\.actions>button\{([^}]*)\}/)?.[1] ?? ''

    expect(markup).toContain('class="actions"')
    expect(bar).toMatch(/left:24rpx;right:24rpx/)
    expect(bar).toContain('width:auto')
    expect(bar).toContain('display:flex')
    expect(buttons).toContain('min-width:0')
    expect(buttons).toContain('flex:1 1 0')
    expect(buttons).toContain('align-items:center')
    expect(buttons).toContain('justify-content:center')
    expect(markup).toContain('disabled="{{saving || publishing || !summary.complete}}"')
  })
})
