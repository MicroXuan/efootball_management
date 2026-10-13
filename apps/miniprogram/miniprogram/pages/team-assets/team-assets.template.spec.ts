import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const markup = readFileSync(resolve(__dirname, 'index.wxml'), 'utf8')

describe('team assets template', () => {
  it('keeps the summary compact and omits aggregate valuation notices', () => {
    expect(markup).not.toContain('球队总资产')
    expect(markup).not.toContain('valuation-status')
    expect(markup).not.toContain('completenessCopy')
  })

  it('shows the roster position and AT value without a card-pack label', () => {
    expect(markup).toContain('{{item.positionCopy}}')
    expect(markup).toContain('<label>AT</label><text>{{item.atCopy}}</text>')
    expect(markup).not.toContain('{{item.cardCopy}}')
  })

  it('shows a real WeChat avatar only and keeps team identity and division visible', () => {
    expect(markup).toContain('wx:if="{{assets.ownerAvatarUrl}}"')
    expect(markup).not.toContain('owner-avatar-placeholder')
    expect(markup).toContain('{{assets.identityCopy}}')
    expect(markup).toContain('{{assets.divisionCopy}}')
  })
})
