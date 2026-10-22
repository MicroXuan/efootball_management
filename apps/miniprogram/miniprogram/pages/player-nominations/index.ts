import type { MyNominationWorkspace } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { listPlayerMarket } from '../../services/player-market'
import { nominationsApi } from '../../services/nominations'
import { formatLocalDate } from '../competitions/competitions.viewmodel'
import { marketPlayerCard } from '../player-market/player-market.viewmodel'

type Options = { leagueId?: string; seasonId?: string; windowId?: string }
type PlayerTap = { currentTarget: { dataset: { playerId?: string; nominationId?: string } } }
type NominationPlayer = ReturnType<typeof marketPlayerCard> & { nominated: boolean }
type NominationCard = MyNominationWorkspace['nominations'][number] & {
  portraitUrl: string; portraitFallback: string; clubLabel: string; nationalityLabel: string;
  cardName: string; position: string; overallLabel: string
}

Page({
  data: {
    state: 'loading' as 'loading' | 'loaded' | 'empty' | 'error', errorMessage: '',
    leagueId: '', seasonId: '', windowId: '', workspace: null as MyNominationWorkspace | null,
    open: false, deadlineLabel: '', keyword: '', players: [] as NominationPlayer[], nominationCards: [] as NominationCard[], searched: false, searching: false, busy: false,
  },
  async onLoad(options: Options) {
    if (!options.leagueId || !options.seasonId) { this.setData({ state: 'error', errorMessage: '缺少联赛或赛季参数' }); return }
    this.setData({ leagueId: options.leagueId, seasonId: options.seasonId, windowId: options.windowId ?? '' })
    await this.loadPage()
  },
  onShow() { if (this.data.leagueId && this.data.state !== 'loading') void this.loadPage(false) },
  onPullDownRefresh() { void this.loadPage(false).finally(() => wx.stopPullDownRefresh()) },
  async loadPage(showLoading = true) {
    if (showLoading) this.setData({ state: 'loading', errorMessage: '' })
    try {
      let windowId = this.data.windowId
      if (!windowId) {
        const response = await nominationsApi.listWindows(this.data.leagueId, this.data.seasonId)
        const now = Date.now()
        windowId = response.items.find((item) => Date.parse(item.startsAt) <= now && now < Date.parse(item.endsAt))?.id ?? response.items[0]?.id ?? ''
        if (!windowId) {
          this.setData({ state: 'empty', windowId: '', workspace: null, open: false, deadlineLabel: '', players: [], nominationCards: [] })
          return
        }
      }
      const workspace = await nominationsApi.workspace(windowId)
      const nominatedIds = new Set(workspace.nominations.map((item) => item.playerId))
      const nominationCards = workspace.nominations.map((item) => ({
        ...item, portraitUrl: item.player?.card?.imageUrl ?? '', portraitFallback: item.playerName.trim().slice(0, 1) || '球',
        clubLabel: item.player?.clubLabel ?? '俱乐部未知', nationalityLabel: item.player?.nationalityLabel ?? '国籍未知',
        cardName: item.player?.card?.cardName ?? '球员卡待补充',
        position: item.player?.card?.position ?? '—',
        overallLabel: item.player?.card?.maxOverall === null || item.player?.card?.maxOverall === undefined ? '—' : String(item.player.card.maxOverall)
      }))
      this.setData({ state: 'loaded', windowId, workspace, open: workspace.isOpen, deadlineLabel: formatLocalDate(workspace.window.endsAt),
        nominationCards, players: this.data.players.map((item) => ({ ...item, nominated: nominatedIds.has(item.playerId) })) })
    } catch (error) {
      this.setData({
        state: !showLoading && this.data.state === 'loaded' ? 'loaded' : 'error',
        errorMessage: error instanceof ApiError ? error.message : '提名信息加载失败',
      })
    }
  },
  onKeywordInput(event: { detail: { value: string } }) { this.setData({ keyword: event.detail.value, players: [], searched: false }) },
  async searchPlayers() {
    if (!this.data.open || !this.data.workspace || this.data.searching) return
    this.setData({ searching: true, errorMessage: '' })
    try {
      const response = await listPlayerMarket(this.data.leagueId, { seasonId: this.data.seasonId, keyword: this.data.keyword.trim() || undefined, ownership: 'FREE', limit: 30 })
      const nominatedIds = new Set(this.data.workspace.nominations.map((item) => item.playerId))
      this.setData({ players: response.items.map((item) => ({ ...marketPlayerCard(item), nominated: nominatedIds.has(item.playerId) })), searched: true })
    } catch { this.setData({ errorMessage: '球员搜索失败，请稍后重试' }) }
    finally { this.setData({ searching: false }) }
  },
  async nominate(event: PlayerTap) {
    const playerId = event.currentTarget.dataset.playerId
    if (!playerId || !this.data.open || !this.data.workspace || this.data.workspace.remainingSlots < 1 || this.data.busy || this.data.players.some((item) => item.playerId === playerId && item.nominated)) return
    this.setData({ busy: true, errorMessage: '' })
    try {
      await nominationsApi.submit(this.data.windowId, playerId)
      await this.loadPage(false)
      wx.showToast({ title: '已加入提名名单', icon: 'success' })
    } catch (error) { this.setData({ errorMessage: error instanceof ApiError ? error.message : '提交提名失败' }) }
    finally { this.setData({ busy: false }) }
  },
  async withdraw(event: PlayerTap) {
    const nominationId = event.currentTarget.dataset.nominationId
    if (!nominationId || !this.data.open || this.data.busy) return
    this.setData({ busy: true, errorMessage: '' })
    try {
      await nominationsApi.withdraw(this.data.windowId, nominationId)
      await this.loadPage(false)
      wx.showToast({ title: '已撤回提名', icon: 'success' })
    } catch (error) { this.setData({ errorMessage: error instanceof ApiError ? error.message : '撤回失败' }) }
    finally { this.setData({ busy: false }) }
  },
})
