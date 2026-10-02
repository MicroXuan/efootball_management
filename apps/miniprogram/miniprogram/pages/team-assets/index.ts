import type { TeamAssetOverview } from '@efm/contracts'
import { economyApi } from '../../services/economy'
import { teamAssetsView } from './team-assets.viewmodel'

Page({ data: { state: 'loading' as 'loading'|'loaded'|'error', errorMessage: '', teamId: '', assets: null as ReturnType<typeof teamAssetsView>|null }, onLoad(options: { teamId?: string }) { if (!options.teamId) this.setData({ state: 'error', errorMessage: '球队参数缺失' }); else { this.setData({ teamId: options.teamId }); void this.loadPage() } }, async loadPage() { this.setData({ state: 'loading' }); try { const assets: TeamAssetOverview = await economyApi.assets(this.data.teamId); this.setData({ state: 'loaded', assets: teamAssetsView(assets) }) } catch { this.setData({ state: 'error', errorMessage: '球队资产加载失败，请稍后重试' }) } } })
