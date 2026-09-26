import type { CompetitionSummary, MyCompetitionResponse } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { competitionsApi } from '../../services/competitions'
import { session } from '../../services/session'
import { competitionErrorMessage, mergeCompetitionPages, toCompetitionCard } from './competitions.viewmodel'

let unloaded = false

Page({
  data: {
    loading: true,
    loadingMore: false,
    errorMessage: '',
    items: [] as Array<ReturnType<typeof toCompetitionCard>>,
    rawItems: [] as CompetitionSummary[],
    nextCursor: null as string | null,
    hasMore: true,
  },

  onLoad() {
    unloaded = false
    void this.load('refresh')
  },

  onShow() {
    if (!this.data.loading && this.data.rawItems.length > 0) void this.load('refresh')
  },

  onUnload() { unloaded = true },
  onPullDownRefresh() { void this.load('refresh').finally(() => wx.stopPullDownRefresh()) },
  onReachBottom() { if (this.data.hasMore && !this.data.loadingMore) void this.load('append') },
  retry() { void this.load('refresh') },

  openDetail(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = event.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/competition-detail/index?id=${encodeURIComponent(id)}` })
  },

  async load(mode: 'refresh' | 'append') {
    this.setData(mode === 'append' ? { loadingMore: true } : { loading: true, errorMessage: '' })
    try {
      const publicPage = await competitionsApi.list(mode === 'append' ? this.data.nextCursor ?? undefined : undefined)
      const mine = session.getAccessToken() ? await competitionsApi.mine(undefined, 100).catch(() => null) : null
      const registrations = new Map<string, MyCompetitionResponse['registration']>(
        (mine?.items ?? []).map((item) => [item.competition.id, item.registration]),
      )
      const rawItems = mode === 'append'
        ? mergeCompetitionPages(this.data.rawItems, publicPage.items)
        : publicPage.items
      if (!unloaded) this.setData({
        rawItems,
        items: rawItems.map((item) => toCompetitionCard(item, registrations.get(item.id)?.status)),
        nextCursor: publicPage.nextCursor,
        hasMore: Boolean(publicPage.nextCursor),
        errorMessage: '',
      })
    } catch (error) {
      if (!unloaded) this.setData({
        errorMessage: competitionErrorMessage(error instanceof ApiError ? error : {}),
      })
    } finally {
      if (!unloaded) this.setData({ loading: false, loadingMore: false })
    }
  },
})
