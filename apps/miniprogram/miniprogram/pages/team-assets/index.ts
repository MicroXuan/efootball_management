import type { TeamAssetOverview } from '@efm/contracts'
import { economyApi } from '../../services/economy'
import { teamAssetsView } from './team-assets.viewmodel'

type AssetStatus = 'ACTIVE'|'DISAPPEARED'|'RETIRED'
type AssetsView = ReturnType<typeof teamAssetsView>

Page({
  data: {
    state: 'loading' as 'loading'|'loaded'|'error',
    errorMessage: '',
    teamId: '',
    selectedStatus: 'ACTIVE' as AssetStatus,
    assets: null as AssetsView|null,
    rosterPlayers: [] as AssetsView['active']
  },
  onLoad(options: { teamId?: string }) {
    if (!options.teamId) this.setData({ state: 'error', errorMessage: '球队参数缺失' })
    else { this.setData({ teamId: options.teamId }); void this.loadPage() }
  },
  async loadPage() {
    this.setData({ state: 'loading' })
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
  }
})
