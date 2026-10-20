import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const markup = readFileSync(resolve(__dirname, 'index.wxml'), 'utf8')
const styles = readFileSync(resolve(__dirname, 'index.wxss'), 'utf8')

describe('team assets template', () => {
  it('offers one league directory link in the asset header, outside player cards', () => {
    const hero = markup.slice(markup.indexOf('<view class="hero">'), markup.indexOf('<view class="metrics">'))
    expect(hero).toContain('bindtap="openTeamDirectory"')
    expect(hero).toContain('浏览联赛球队')
    expect(markup.match(/bindtap="openTeamDirectory"/g)).toHaveLength(1)
    expect(styles).toMatch(/\.team-directory-link\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s)
  })

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

  it('renders player tags beside the player name when present', () => {
    expect(markup).toContain('wx:if="{{item.tagLabels.length}}"')
    expect(markup).toContain('{{tag}}')
    expect(styles).toMatch(/\.player-tags\s*\{[^}]*flex-wrap:\s*wrap/)
  })

  it('shows a real WeChat avatar only and keeps team identity and division visible', () => {
    expect(markup).toContain('wx:if="{{assets.ownerAvatarUrl}}"')
    expect(markup).not.toContain('owner-avatar-placeholder')
    expect(markup).toContain('{{assets.identityCopy}}')
    expect(markup).toContain('{{assets.divisionCopy}}')
  })

  it('uses the right side of the compact team card for division and user number without truncating identity', () => {
    const hero = markup.match(/<view class="hero">([\s\S]*?)<\/view>\s*<view class="metrics">/)?.[1]
    expect(hero).toMatch(/class="hero-topline"[\s\S]*class="division"/)
    expect(hero).toMatch(/class="hero-name-row"[\s\S]*class="title"[\s\S]*class="owner-number"/)
    expect(hero).toMatch(/class="identity"[^>]*>\{\{assets\.identityCopy\}\}/)
    expect(styles).toMatch(/\.hero-name-row\s*\{[^}]*flex-wrap:\s*wrap/)
    expect(styles).toMatch(/\.identity\s*\{[^}]*white-space:\s*normal/)
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

  it('keeps the four summary tiles compact and the roster fraction on one line', () => {
    const metricRule = styles.match(/\.metric\s*\{([^}]*)\}/)?.[1] ?? ''
    const minHeight = Number(metricRule.match(/min-height:\s*(\d+)rpx/)?.[1])
    expect(minHeight).toBeLessThanOrEqual(88)
    expect(styles).toMatch(/\.metric-suffix\s*\{[^}]*display:\s*inline/)
    expect(markup).toMatch(/\{\{assets\.activePlayerCount\}\}<text class="metric-suffix">\/25<\/text>/)
  })

  it('centers disappearance and transfer labels inside their equal-width action buttons', () => {
    expect(markup).toContain("'标记消失'")
    expect(markup).toContain('>申请转会</button>')
    expect(styles).toMatch(/\.asset-action\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s)
  })

  it('keeps only release and disappearance on owned players', () => {
    const ownerActions = markup.match(/<view wx:if="\{\{assets\.isOwner && selectedStatus === 'ACTIVE'\}\}" class="asset-actions">([\s\S]*?)<\/view>/)?.[1]
    expect(ownerActions).toBeDefined()
    expect(ownerActions).toMatch(/>下放<\/button>[\s\S]*>\{\{item\.pendingDisappearance \? '消失申请待审核' : '标记消失'\}\}<\/button>/)
    expect(ownerActions).not.toContain('bindtap="openTransfer"')
    expect(markup).not.toContain('下放后立即释放 1 个阵容名额')
    expect(markup).not.toContain('class="release-row"')
    expect(markup).toContain("!item.releaseEnabled && item.releaseDisabledCopy}}\" class=\"release-disabled\"")
  })

  it('shows a reason-free disappearance sheet and a buyer-only fixed destination', () => {
    expect(markup).toContain('wx:if="{{disappearanceDraft}}"')
    expect(markup).toContain('管理员审核通过后，球员才会移入已消失')
    expect(markup).not.toContain('填写消失原因')
    expect(markup).toContain('disabled="{{!!transferLoadingPlayerId || submittingRequest}}"')
    expect(markup).toContain('转入我的球队')
    expect(markup).not.toContain('bindchange="onTransferTargetChange"')
  })

  it('keeps the complete transfer confirmation label legible in enabled and disabled states', () => {
    expect(markup).toContain('>发送给对方确认</button>')
    expect(styles).toMatch(/\.transfer-buttons button\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*min-width:\s*0/s)
    const disabled = styles.match(/\.transfer-buttons \.transfer-submit\[disabled\]\s*\{([^}]*)\}/)?.[1] ?? ''
    const foreground = disabled.match(/(?:^|;)\s*color:\s*(#[0-9a-f]{6})/i)?.[1]
    const background = disabled.match(/(?:^|;)\s*background:\s*(#[0-9a-f]{6})/i)?.[1]
    const luminance = (hex: string) => {
      const channels = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
      return channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
        .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index]!, 0)
    }
    expect(foreground && background ? (Math.max(luminance(foreground), luminance(background)) + 0.05) /
      (Math.min(luminance(foreground), luminance(background)) + 0.05) : 0).toBeGreaterThanOrEqual(4.5)
    expect(disabled).toMatch(/opacity:\s*1/)
  })

  it('places the transfer list entry with the roster heading rather than under the metrics', () => {
    const rosterHead = markup.match(/<view class="roster-head">([\s\S]*?)<\/view>\s*<view class="roster-tabs/)?.[1]
    expect(rosterHead).toContain('bindtap="openTransferList"')
    expect(rosterHead).toContain('我的协商转会')
    expect(markup.indexOf('bindtap="openTransferList"')).toBeGreaterThan(markup.indexOf('class="roster-head"'))
  })
})
