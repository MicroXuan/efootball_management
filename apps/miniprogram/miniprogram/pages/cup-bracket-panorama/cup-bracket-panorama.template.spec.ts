import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const markup = readFileSync(resolve(__dirname, 'index.wxml'), 'utf8')

describe('cup bracket panorama template', () => {
  it('renders the complete bracket as a pannable and zoomable board', () => {
    expect(markup).toContain('<movable-area')
    expect(markup).toContain('<movable-view')
    expect(markup).toContain('scale-value="{{scale}}"')
    expect(markup).toContain('bindscale="trackScale"')
    expect(markup).toContain('bindtap="zoomOut"')
    expect(markup).toContain('bindtap="zoomIn"')
    expect(markup).toContain('bindtap="resetViewport"')
    expect(markup).toContain('teamLogoUrl')
    expect(markup).toContain('teamNumber')
  })
})
