import type { PublicTeamAssets, TeamAssetOverview } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { economyApi } from '../../services/economy'
import { leagueTeamsApi } from '../../services/league-teams'
import { playerRequestsApi } from '../../services/player-requests'
import type { TransferCandidate } from '@efm/contracts'
import { forcedOfferRoute, teamAssetsView } from './team-assets.viewmodel'

type AssetStatus = 'ACTIVE'|'DISAPPEARED'|'RETIRED'
type AssetsView = ReturnType<typeof teamAssetsView>
type ReleaseEvent = { currentTarget: { dataset: { ownershipId?: string; playerName?: string } } }
type PlayerEvent = { currentTarget: { dataset: { playerId?: string; ownershipId?: string; playerName?: string } } }
type Target = { teamId: string; teamName: string; teamNumber: number | null }

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
  appearedOnce: false,
  data: {
    state: 'loading' as 'loading'|'loaded'|'error',
    errorMessage: '',
    teamId: '',
    leagueId: '',
    publicView: false,
    returnTo: '',
    releasingOwnershipId: '',
    submittingRequest: false,
    transferCandidate: null as TransferCandidate|null,
    transferPlayerName: '',
    transferTargets: [] as Target[],
    transferTargetIndex: 0,
    transferAmount: '',
    transferReason: '',
    selectedStatus: 'ACTIVE' as AssetStatus,
    assets: null as AssetsView|null,
    rosterPlayers: [] as AssetsView['active']
  },
  onLoad(options: { teamId?: string; leagueId?: string; view?: string; returnTo?: string }) {
    if (!options.teamId) this.setData({ state: 'error', errorMessage: '球队参数缺失' })
    else if (options.view === 'public' && !options.leagueId) this.setData({ state: 'error', errorMessage: '联赛参数缺失' })
    else { this.setData({ teamId: options.teamId, leagueId: options.leagueId ?? '', publicView: options.view === 'public', returnTo: options.returnTo ?? '' }); void this.loadPage() }
  },
  onShow() {
    if (this.appearedOnce && this.data.teamId) void this.loadPage(false)
    this.appearedOnce = true
  },
  onPullDownRefresh() { void this.loadPage(false).finally(() => wx.stopPullDownRefresh()) },
  async loadPage(showLoading = true) {
    if (showLoading) this.setData({ state: 'loading' })
    try {
      const assets: TeamAssetOverview | PublicTeamAssets = this.data.publicView
        ? await economyApi.publicAssets(this.data.leagueId, this.data.teamId)
        : await economyApi.assets(this.data.teamId)
      const viewer = this.data.publicView
        ? await leagueTeamsApi.mine().then((mine) => { const team = mine.items.find((item) => item.leagueId === this.data.leagueId && item.currentSeason?.id); return team?.currentSeason ? { teamId: team.id, seasonId: team.currentSeason.id } : null }).catch(() => null)
        : null
      const ownerSeasonId = !this.data.publicView ? (assets as TeamAssetOverview).seasonId : null
      const pendingIds = ownerSeasonId
        ? await playerRequestsApi.listDisappearance(ownerSeasonId).then((result) => result.items.filter((item) => item.status === 'PENDING').map((item) => item.ownershipId)).catch(() => [])
        : []
      const view = teamAssetsView(assets, viewer, pendingIds)
      this.setData({ state: 'loaded', assets: view, selectedStatus: 'ACTIVE', rosterPlayers: view.active })
    } catch {
      this.setData({ state: 'error', errorMessage: '球队资产加载失败，请稍后重试' })
    }
  },
  confirmDisappearance(event: PlayerEvent) {
    const ownershipId = event.currentTarget.dataset.ownershipId
    const playerName = event.currentTarget.dataset.playerName
    const player = this.data.assets?.active.find((item) => item.ownershipId === ownershipId)
    if (!ownershipId || !player?.disappearanceEnabled || this.data.submittingRequest) return
    wx.showModal({ title: `申请标记 ${playerName ?? '球员'} 为已消失`, content: '提交后仍在一线阵容，管理员批准后才移入已消失。',
      editable: true, placeholderText: '填写消失原因（必填）', confirmText: '提交审核',
      success: ({ confirm, content }) => {
        if (!confirm) return
        if (!content?.trim()) { wx.showToast({ title: '请填写原因', icon: 'none' }); return }
        void this.submitDisappearance(ownershipId, player.ownershipVersion!, content.trim())
      } })
  },
  async submitDisappearance(ownershipId: string, expectedOwnershipVersion: number, reason: string) {
    const seasonId = this.data.assets?.seasonId
    if (!seasonId) return
    this.setData({ submittingRequest: true, errorMessage: '' })
    try {
      await playerRequestsApi.submitDisappearance(this.data.teamId, ownershipId, { seasonId, reason, expectedOwnershipVersion }, releaseKey())
      await this.loadPage(false)
      wx.showToast({ title: '已提交管理员审核', icon: 'success' })
    } catch (error) {
      this.setData({ errorMessage: error instanceof ApiError ? error.message : '申请失败，请稍后重试' })
      if (error instanceof ApiError && /CONFLICT|CHANGED|EXISTS/.test(error.code)) await this.loadPage(false)
    } finally { this.setData({ submittingRequest: false }) }
  },
  async openTransfer(event: PlayerEvent) {
    const playerId = event.currentTarget.dataset.playerId
    const playerName = event.currentTarget.dataset.playerName ?? '球员'
    const assets = this.data.assets
    if (!playerId || !assets?.viewerTeamId || !assets.seasonId || this.data.submittingRequest) return
    this.setData({ submittingRequest: true, errorMessage: '' })
    try {
      const candidate = await playerRequestsApi.transferCandidate(assets.leagueId, assets.seasonId, playerId)
      if (!candidate.eligible) { this.setData({ errorMessage: candidate.reason ?? '当前不能发起转会' }); return }
      const targets = assets.isOwner
        ? await leagueTeamsApi.directory(assets.leagueId).then((result) => result.items.filter((item) => item.teamId !== assets.teamId).map((item) => ({ teamId: item.teamId, teamName: item.teamName, teamNumber: item.teamNumber })))
        : [{ teamId: assets.viewerTeamId, teamName: '我的球队', teamNumber: null }]
      if (!targets.length) { this.setData({ errorMessage: '暂无可转入的球队' }); return }
      this.setData({ transferCandidate: candidate, transferPlayerName: playerName, transferTargets: targets,
        transferTargetIndex: 0, transferAmount: '', transferReason: '' })
    } catch (error) { this.setData({ errorMessage: error instanceof ApiError ? error.message : '转会资格查询失败' }) }
    finally { this.setData({ submittingRequest: false }) }
  },
  onTransferTargetChange(event: { detail: { value: string } }) { this.setData({ transferTargetIndex: Number(event.detail.value) || 0 }) },
  onTransferAmountInput(event: { detail: { value: string } }) { this.setData({ transferAmount: event.detail.value.replace(/\D/g, '') }) },
  onTransferReasonInput(event: { detail: { value: string } }) { this.setData({ transferReason: event.detail.value }) },
  closeTransfer() { if (!this.data.submittingRequest) this.setData({ transferCandidate: null }) },
  async submitTransfer() {
    const assets = this.data.assets
    const candidate = this.data.transferCandidate
    const target = this.data.transferTargets[this.data.transferTargetIndex]
    const amountMinor = Number(this.data.transferAmount)
    if (!assets?.viewerTeamId || !assets.seasonId || !candidate || !target || this.data.submittingRequest) return
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) { this.setData({ errorMessage: '请输入大于 0 的转会报价' }); return }
    this.setData({ submittingRequest: true, errorMessage: '' })
    try {
      await playerRequestsApi.submitTransfer({ seasonId: assets.seasonId, initiatorTeamId: assets.viewerTeamId,
        ownershipId: candidate.ownershipId, targetTeamId: target.teamId, amountMinor,
        expectedOwnershipVersion: candidate.ownershipVersion, reason: this.data.transferReason.trim() || undefined }, releaseKey())
      this.setData({ transferCandidate: null })
      wx.showToast({ title: '已发送给对方确认', icon: 'success' })
    } catch (error) {
      this.setData({ errorMessage: error instanceof ApiError ? error.message : '转会申请失败，请稍后重试' })
      if (error instanceof ApiError && /CHANGED|CONFLICT|WINDOW/.test(error.code)) await this.loadPage(false)
    } finally { this.setData({ submittingRequest: false }) }
  },
  openForcedOffer(event: PlayerEvent) {
    const playerId = event.currentTarget.dataset.playerId
    const assets = this.data.assets
    const url = playerId && assets ? forcedOfferRoute(assets, playerId) : null
    if (url) wx.navigateTo({ url })
  },
  openTransferList() {
    const seasonId = this.data.assets?.seasonId
    if (seasonId && this.data.assets?.viewerTeamId) wx.navigateTo({ url: `/pages/transfer-proposals/index?seasonId=${encodeURIComponent(seasonId)}` })
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
    if (!ownershipId || !playerName || this.data.publicView || this.data.releasingOwnershipId) return
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
    if (!assets?.isOwner || !assets.seasonId || !assets.activeTransferWindowId || !player?.ownershipVersion || !player.releaseEnabled) return
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
