import type { TeamAssetOverview } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { economyApi } from '../../services/economy'
import { teamAssetsView } from './team-assets.viewmodel'

type AssetStatus = 'ACTIVE'|'DISAPPEARED'|'RETIRED'
type AssetsView = ReturnType<typeof teamAssetsView>
type ReleaseEvent = { currentTarget: { dataset: { ownershipId?: string; playerName?: string } } }

function releaseKey(): string {
  return `release-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function releaseError(code: string): string {
  const messages: Record<string, string> = {
    TRANSFER_WINDOW_CLOSED: '下放窗口已关闭，请刷新查看最新状态',
    VERSION_CONFLICT: '球员状态已变化，请刷新后重试',
    OWNERSHIP_NOT_ACTIVE: '该球员已不在现役阵容',
    TEAM_ASSET_OWNER_REQUIRED: '只有球队负责人可以下放球员',
    LEAGUE_PARTICIPANT_REQUIRED: '当前账号没有该球队的操作权限',
  }
  return messages[code] ?? '下放未完成，请刷新后重试'
}

Page({
  data: {
    state: 'loading' as 'loading'|'loaded'|'error',
    errorMessage: '',
    teamId: '',
    returnTo: '',
    releasingOwnershipId: '',
    selectedStatus: 'ACTIVE' as AssetStatus,
    assets: null as AssetsView|null,
    rosterPlayers: [] as AssetsView['active']
  },
  onLoad(options: { teamId?: string; returnTo?: string }) {
    if (!options.teamId) this.setData({ state: 'error', errorMessage: '球队参数缺失' })
    else { this.setData({ teamId: options.teamId, returnTo: options.returnTo ?? '' }); void this.loadPage() }
  },
  async loadPage(showLoading = true) {
    if (showLoading) this.setData({ state: 'loading' })
    try {
      const assets: TeamAssetOverview = await economyApi.assets(this.data.teamId)
      const view = teamAssetsView(assets)
      this.setData({ state: 'loaded', assets: view, selectedStatus: 'ACTIVE', rosterPlayers: view.active })
    } catch {
      this.setData({ state: 'error', errorMessage: '球队资产加载失败，请稍后重试' })
    }
  },
  switchRoster(event: WechatMiniprogram.BaseEvent) {
    const status = event.currentTarget.dataset.status as AssetStatus|undefined
    if (!status || status === this.data.selectedStatus || !this.data.assets) return
    const rosterPlayers = status === 'ACTIVE'
      ? this.data.assets.active
      : status === 'DISAPPEARED' ? this.data.assets.disappeared : this.data.assets.retired
    this.setData({ selectedStatus: status, rosterPlayers })
  },
  confirmRelease(event: ReleaseEvent) {
    const ownershipId = event.currentTarget.dataset.ownershipId
    const playerName = event.currentTarget.dataset.playerName
    if (!ownershipId || !playerName || this.data.releasingOwnershipId) return
    wx.showModal({
      title: `确认下放 ${playerName}？`,
      content: '下放立即生效、没有收入、不能自动撤销；后续申请失败也不会返回阵容。',
      confirmText: '确认下放', confirmColor: '#C94F49',
      success: ({ confirm }) => { if (confirm) void this.releasePlayer(ownershipId) },
    })
  },
  async releasePlayer(ownershipId: string) {
    const assets = this.data.assets
    const player = assets?.active.find((item) => item.ownershipId === ownershipId)
    if (!assets?.seasonId || !assets.activeTransferWindowId || !player?.ownershipVersion || !player.releaseEnabled) return
    this.setData({ releasingOwnershipId: ownershipId, errorMessage: '' })
    try {
      await economyApi.releasePlayer(this.data.teamId, ownershipId, {
        seasonId: assets.seasonId,
        transferWindowId: assets.activeTransferWindowId,
        ownershipId,
        expectedVersion: player.ownershipVersion,
        reason: '为新球员腾出阵容名额',
      }, releaseKey())
      await this.loadPage(false)
      if (this.data.returnTo === 'player-market') this.returnToPlayerMarket()
      else wx.showToast({ title: '下放成功', icon: 'success' })
    } catch (error) {
      this.setData({ errorMessage: releaseError(error instanceof ApiError ? error.code : 'UNKNOWN') })
    } finally {
      this.setData({ releasingOwnershipId: '' })
    }
  },
  returnToPlayerMarket() {
    const pages = getCurrentPages()
    const marketIndex = pages.map((page) => page.route).lastIndexOf('pages/player-market/index')
    const delta = marketIndex >= 0 ? pages.length - 1 - marketIndex : 1
    wx.navigateBack({ delta: Math.max(1, delta) })
  }
})
