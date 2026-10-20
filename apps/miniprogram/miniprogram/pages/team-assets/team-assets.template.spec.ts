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

  it('only exposes release on eligible active players and explains the irreversible effect', () => {
    expect(markup).toContain('wx:if="{{assets.isOwner && selectedStatus === \'ACTIVE\'}}"')
    expect(markup).toContain('data-ownership-id="{{item.ownershipId}}"')
    expect(markup).toContain('bindtap="confirmRelease"')
    expect(markup).toContain('本赛季强报')
    const controller = readFileSync(resolve(__dirname, 'index.ts'), 'utf8')
    expect(controller).toContain('立即生效')
    expect(controller).toContain('没有收入')
    expect(controller).toContain('不能自动撤销')
    expect(controller).toContain('后续申请失败也不会返回')
    expect(controller).toContain('returnTo')
    expect(controller).toContain('wx.navigateBack')
  })

  it('puts salary cap and roster count first while keeping public visitors read-only', () => {
    expect(markup).toContain('{{assets.salaryCopy}}')
    expect(markup).toContain('wx:if="{{assets.isOwner}}"')
    expect(markup.indexOf('工资 / 工资帽')).toBeLessThan(markup.indexOf('球员总身价'))
    expect(markup).toContain('disabled="{{!item.releaseEnabled || !!releasingOwnershipId}}"')
  })
})
