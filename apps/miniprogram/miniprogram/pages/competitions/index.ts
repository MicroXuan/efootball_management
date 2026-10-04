import type { CompetitionSummary, MyCompetitionResponse } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { competitionsApi } from '../../services/competitions'
import { session } from '../../services/session'
import {
  competitionErrorMessage,
  competitionListContext,
  mergeCompetitionPages,
  toCompetitionCard,
} from './competitions.viewmodel'

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
    seasonId: '',
    category: '' as '' | 'CUP',
    kicker: '赛事中枢',
    title: '赛事中枢',
    headMark: '比赛日程 · 02',
    briefingLabel: '本周任务',
    briefingCopy: '报名、赛程与积分，都在一条比赛时间线上。',
    emptyCode: '暂无赛程',
    emptyTitle: '暂时没有公开赛事',
    emptyCopy: '新赛事发布后会出现在这里。',
  },

  onLoad(options: { seasonId?: string; leagueName?: string }) {
    unloaded = false
    const context = competitionListContext(options)
    this.setData({ ...context, category: context.category ?? '' })
    wx.setNavigationBarTitle({ title: context.title })
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
      const publicPage = await competitionsApi.list({
        cursor: mode === 'append' ? this.data.nextCursor ?? undefined : undefined,
        seasonId: this.data.seasonId || undefined,
        category: this.data.category || undefined,
      })
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
