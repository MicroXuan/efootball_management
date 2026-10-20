import type { PlayerMarketPlayerDetail } from '@efm/contracts'
import { ApiError } from '../../services/api'
import {
  amendPlayerApplication,
  createPlayerMarketMutationKey,
  getPlayerMarketDetail,
  submitPlayerApplication,
  withdrawPlayerApplication,
} from '../../services/player-market'
import { applicationCard } from '../player-market/player-market.viewmodel'
import { detailAction, marketErrorAction, playerMarketDetailView } from './player-market-detail.viewmodel'
import { activeForcedOfferCopy } from './forced-offer-copy'

type LoadOptions = { leagueId?: string; seasonId?: string; teamId?: string; playerId?: string }
type InputEvent = { detail: { value: string } }

Page({
  detail: null as PlayerMarketPlayerDetail | null,
  data: {
    state: 'loading' as 'loading' | 'loaded' | 'empty' | 'error',
    errorMessage: '', leagueId: '', seasonId: '', teamId: '', playerId: '',
    player: null as ReturnType<typeof playerMarketDetailView> | null,
    publicApplications: [] as ReturnType<typeof applicationCard>[],
    myApplication: null as ReturnType<typeof applicationCard> | null,
    showComposer: false, amount: '', amountHint: '', submitting: false,
    recoveryLabel: '', recoveryRoute: '',
    forcedCopyText: '',
  },

  onLoad(options: LoadOptions) {
    if (!options.leagueId || !options.seasonId || !options.teamId || !options.playerId) {
      this.setData({ state: 'error', errorMessage: '球员交易参数缺失' })
      return
    }
    this.setData({ leagueId: options.leagueId, seasonId: options.seasonId, teamId: options.teamId, playerId: options.playerId })
  },

  onShow() {
    if (this.data.playerId) void this.loadDetail()
  },

  onPullDownRefresh() {
    void this.loadDetail(false).finally(() => wx.stopPullDownRefresh())
  },

  async loadDetail(showLoading = true) {
    if (showLoading) this.setData({ state: 'loading', errorMessage: '', recoveryLabel: '', recoveryRoute: '' })
    try {
      const detail = await getPlayerMarketDetail(this.data.leagueId, this.data.playerId, this.data.seasonId)
      this.detail = detail
      const player = playerMarketDetailView(detail)
      this.setData({
        state: 'loaded', player,
        myApplication: detail.myApplication ? applicationCard(detail.myApplication) : null,
        publicApplications: detail.publicApplications.map(applicationCard),
        amount: detail.myApplication ? String(detail.myApplication.amountMinor) : String(player.minimumAmountMinor),
        amountHint: detail.action === 'FORCE_SIGN' ? `强报不得低于官方身价 ${player.minimumAmountMinor}` : '请输入本次申请金额',
        showComposer: false, errorMessage: '', recoveryLabel: '', recoveryRoute: '',
        forcedCopyText: activeForcedOfferCopy(detail.myApplication, detail.playerEnglishName) ?? '',
      })
    } catch (error) {
      this.setData({ state: 'error', errorMessage: error instanceof ApiError ? error.message : '球员详情加载失败，请稍后重试' })
    }
  },

  openComposer() {
    if (!this.detail) return
    const action = detailAction(this.detail)
    if (this.detail.action === 'DISABLED' || this.detail.action === 'OWNED_BY_ME') {
      if (action.releaseRequired) this.goRelease()
      return
    }
    this.setData({ showComposer: true, amount: String(action.minimumAmountMinor) })
  },

  closeComposer() {
    if (!this.data.submitting) this.setData({ showComposer: false })
  },

  onAmountInput(event: InputEvent) {
    this.setData({ amount: event.detail.value.replace(/\D/g, '') })
  },

  async submitApplication() {
    const detail = this.detail
    const amountMinor = Number(this.data.amount)
    if (!detail || this.data.submitting || !detail.card || !detail.activeTransferWindowId || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) return
    const action = detailAction(detail)
    if (amountMinor < action.minimumAmountMinor) {
      this.setData({ errorMessage: `金额不得低于 ${action.minimumAmountMinor}` })
      return
    }
    this.setData({ submitting: true, errorMessage: '' })
    try {
      const submitted = await submitPlayerApplication(this.data.leagueId, {
        seasonId: this.data.seasonId,
        transferWindowId: detail.activeTransferWindowId,
        footballPlayerId: detail.playerId,
        playerCardId: detail.card.playerCardId,
        type: detail.action === 'FORCE_SIGN' ? 'FORCED_TRANSFER' : 'NORMAL_PURCHASE',
        amountMinor,
        ...(detail.action === 'FORCE_SIGN' && detail.currentOwner && detail.ownershipId && detail.ownershipVersion
          ? { sourceLeagueTeamId: detail.currentOwner.teamId, ownershipId: detail.ownershipId, ownershipVersionSnapshot: detail.ownershipVersion }
          : {}),
      }, createPlayerMarketMutationKey('submit'))
      await this.loadDetail(false)
      this.setData({ forcedCopyText: activeForcedOfferCopy(submitted, detail.playerEnglishName) ?? '' })
      wx.showToast({ title: '申请已提交', icon: 'success' })
    } catch (error) {
      await this.handleMutationError(error)
    } finally {
      this.setData({ submitting: false })
    }
  },

  editApplication() {
    if (!this.detail?.myApplication) return
    this.setData({ showComposer: true, amount: String(this.detail.myApplication.amountMinor) })
  },

  async amendApplication() {
    const application = this.detail?.myApplication
    const amountMinor = Number(this.data.amount)
    if (!application || this.data.submitting || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) return
    this.setData({ submitting: true, errorMessage: '' })
    try {
      const amended = await amendPlayerApplication(application.id, { amountMinor, expectedVersion: application.version }, createPlayerMarketMutationKey('amend'))
      await this.loadDetail(false)
      this.setData({ forcedCopyText: activeForcedOfferCopy(amended, this.detail?.playerEnglishName ?? null) ?? '' })
      wx.showToast({ title: '报价已更新', icon: 'success' })
    } catch (error) {
      await this.handleMutationError(error)
    } finally {
      this.setData({ submitting: false })
    }
  },

  confirmComposer() {
    if (this.detail?.myApplication) void this.amendApplication()
    else void this.submitApplication()
  },

  async withdrawApplication() {
    const application = this.detail?.myApplication
    if (!application || this.data.submitting) return
    this.setData({ submitting: true, errorMessage: '' })
    try {
      await withdrawPlayerApplication(application.id, { expectedVersion: application.version, reason: '用户主动撤回申请' }, createPlayerMarketMutationKey('withdraw'))
      await this.loadDetail(false)
      wx.showToast({ title: '申请已撤回', icon: 'success' })
    } catch (error) {
      await this.handleMutationError(error)
    } finally {
      this.setData({ submitting: false })
    }
  },

  async handleMutationError(error: unknown) {
    const action = marketErrorAction(error instanceof ApiError ? error.code : 'UNKNOWN', this.data.teamId)
    this.setData({ errorMessage: action.message, recoveryLabel: action.actionLabel, recoveryRoute: action.route ?? '' })
    if (!action.route) await this.loadDetail(false)
  },

  goRelease() {
    wx.navigateTo({ url: `/pages/team-assets/index?teamId=${encodeURIComponent(this.data.teamId)}&returnTo=player-market` })
  },

  runRecovery() {
    if (this.data.recoveryRoute) wx.navigateTo({ url: this.data.recoveryRoute })
    else void this.loadDetail()
  },
  copyForcedOffer() {
    if (!this.data.forcedCopyText) return
    wx.setClipboardData({ data: this.data.forcedCopyText,
      success: () => wx.showToast({ title: '文案已复制', icon: 'success' }),
      fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' }) })
  },
})
