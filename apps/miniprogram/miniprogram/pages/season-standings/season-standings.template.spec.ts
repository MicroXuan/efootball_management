import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const markup = readFileSync(resolve(process.cwd(), 'miniprogram/pages/season-standings/index.wxml'), 'utf8')

describe('season standings template', () => {
  it('renders the season title and complete team identity', () => {
    expect(markup).toContain('{{seasonTitle}}')
    expect(markup).toContain('<entity-artwork')
    expect(markup).toContain('{{item.teamIdentityLabel}}')
    expect(markup).toContain('{{item.ownerDisplayName}}')
  })

  it('renders podium medals and the fourth-place rise marker', () => {
    expect(markup).toContain('{{item.medalLabel}}')
    expect(markup).toContain('wx:if="{{item.showRise}}"')
    expect(markup).toContain('class="rise">↑</text>')
  })
})
