import type { PlayerFavoriteGroup, PlayerFavoriteListQuery } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { favoritesApi } from '../../services/favorites'
import { session } from '../../services/session'
import {
  buildFavoriteQuery,
  favoritePageCopy,
  nextFavoritePageState,
  type FavoritePageState,
} from './favorites.viewmodel'

type InputEvent = { detail: { value: string } }
type CardTapEvent = { detail: { id?: string } }
type PlayerTapEvent = { currentTarget: { dataset: { playerId?: string } } }
type GroupTapEvent = { currentTarget: { dataset: { groupId?: string } } }

let searchTimer: ReturnType<typeof setTimeout> | undefined
let requestToken = 0
let unloaded = false

Page({
  data: {
    state: 'loading' as 'loading' | 'loaded' | 'error',
    errorMessage: '',
    keyword: '',
    groups: [] as PlayerFavoriteGroup[],
    groupNames: {} as Record<string, string>,
    activeGroupId: '',
    activeGroupName: '全部',
    showGroupDropdown: false,
    movingPlayerId: '',
    movingPlayerHasGroup: false,
    showGroupPicker: false,
    items: [] as FavoritePageState['items'],
    cards: [] as FavoritePageState['cards'],
    nextCursor: null as string | null,
    hasMore: true,
    loadingMore: false,
    emptyCopy: favoritePageCopy('empty'),
    errorCopy: favoritePageCopy('error'),
  },

  onLoad() {
    unloaded = false
    if (!session.getAccessToken()) {
      wx.redirectTo({ url: '/pages/login/index' })
      return
    }
    void this.loadGroups()
    void this.loadFavorites('refresh')
  },

  onUnload() {
    unloaded = true
    requestToken += 1
    if (searchTimer) clearTimeout(searchTimer)
  },

  onPullDownRefresh() {
    void this.loadFavorites('refresh').finally(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.loadingMore || !this.data.hasMore) return
    void this.loadFavorites('append')
  },

  onKeywordInput(event: InputEvent) {
    this.setData({ keyword: event.detail.value })
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => void this.loadFavorites('refresh'), 300)
  },

  onSelectGroup(event: GroupTapEvent) {
    const groupId = event.currentTarget.dataset.groupId ?? ''
    const activeGroupName = groupId === '' ? '全部' : groupId === 'ungrouped'
      ? '未分组' : this.data.groups.find((group) => group.id === groupId)?.name ?? '全部'
    this.setData({ showGroupDropdown: false })
    if (groupId === this.data.activeGroupId) return
    this.setData({ activeGroupId: groupId, activeGroupName })
    void this.loadFavorites('refresh')
  },

  onToggleGroupDropdown() {
    this.setData({ showGroupDropdown: !this.data.showGroupDropdown })
  },

  onCloseGroupDropdown() {
    this.setData({ showGroupDropdown: false })
  },

  async onCreateGroup() {
    this.setData({ showGroupDropdown: false })
    const result = await new Promise<WechatMiniprogram.ShowModalSuccessCallbackResult>((resolve) => {
      wx.showModal({ title: '新建分组', editable: true, placeholderText: '输入分组名称', success: resolve })
    })
    if (!result.confirm) return
    const name = result.content.trim()
    if (!name || name.length > 24) {
      wx.showToast({ title: '名称需为 1～24 个字', icon: 'none' })
      return
    }
    try {
      const group = await favoritesApi.createGroup(name)
      await this.loadGroups()
      if (this.data.movingPlayerId) {
        await this.moveFavorite(this.data.movingPlayerId, group.id)
      } else {
        this.setData({ activeGroupId: group.id, activeGroupName: group.name })
        void this.loadFavorites('refresh')
      }
    } catch (error) {
      wx.showToast({ title: error instanceof ApiError ? error.message : '创建分组失败', icon: 'none' })
    }
  },

  onOpenGroupPicker(event: PlayerTapEvent) {
    const playerId = event.currentTarget.dataset.playerId
    if (!playerId) return
    const movingPlayerHasGroup = Boolean(this.data.items.find((item) => item.playerId === playerId)?.groupId)
    this.setData({ movingPlayerId: playerId, movingPlayerHasGroup, showGroupPicker: true })
  },

  onCloseGroupPicker() {
    this.setData({ movingPlayerId: '', movingPlayerHasGroup: false, showGroupPicker: false })
  },

  onPickGroup(event: GroupTapEvent) {
    const playerId = this.data.movingPlayerId
    if (!playerId) return
    const groupId = event.currentTarget.dataset.groupId || null
    void this.moveFavorite(playerId, groupId)
  },

  async moveFavorite(playerId: string, groupId: string | null) {
    try {
      await favoritesApi.move(playerId, groupId)
      this.onCloseGroupPicker()
      const items = this.data.items.map((item) => item.playerId === playerId ? { ...item, groupId } : item)
      this.setData({ items })
      if (this.data.activeGroupId && this.data.activeGroupId !== groupId) void this.loadFavorites('refresh')
      wx.showToast({ title: groupId ? '已移动分组' : '已移出分组', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error instanceof ApiError ? error.message : '移动失败，请重试', icon: 'none' })
    }
  },

  onDeleteGroup(event: GroupTapEvent) {
    this.setData({ showGroupDropdown: false })
    const groupId = event.currentTarget.dataset.groupId
    const group = this.data.groups.find((item) => item.id === groupId)
    if (!group) return
    wx.showModal({
      title: `删除“${group.name}”？`,
      content: '组内球员会回到未分组，收藏仍保留。',
      success: (result) => { if (result.confirm) void this.deleteGroup(group.id) },
    })
  },

  async deleteGroup(groupId: string) {
    try {
      await favoritesApi.deleteGroup(groupId)
      if (this.data.activeGroupId === groupId) this.setData({ activeGroupId: '', activeGroupName: '全部' })
      await this.loadGroups()
      void this.loadFavorites('refresh')
    } catch {
      wx.showToast({ title: '删除分组失败，请重试', icon: 'none' })
    }
  },

  async loadGroups() {
    try {
      const response = await favoritesApi.groups()
      if (unloaded) return
      this.setData({
        groups: response.items,
        groupNames: Object.fromEntries(response.items.map((group) => [group.id, group.name])),
        activeGroupName: this.data.activeGroupId === '' ? '全部' : this.data.activeGroupId === 'ungrouped'
          ? '未分组' : response.items.find((group) => group.id === this.data.activeGroupId)?.name ?? '全部',
      })
    } catch {
      wx.showToast({ title: '分组加载失败', icon: 'none' })
    }
  },

  onCardTap(event: CardTapEvent) {
    const id = event.detail.id
    if (id) wx.navigateTo({ url: `/pages/player-card-detail/index?id=${encodeURIComponent(id)}` })
  },

  async onRemoveFavorite(event: PlayerTapEvent) {
    const playerId = event.currentTarget.dataset.playerId
    if (!playerId) return
    try {
      await favoritesApi.unfavorite(playerId)
      const items = this.data.items.filter((item) => item.playerId !== playerId)
      this.setData({
        items,
        cards: this.data.cards.filter((card) => card.playerId !== playerId),
      })
      wx.showToast({ title: '已取消收藏', icon: 'success' })
    } catch {
      wx.showToast({ title: '取消收藏失败，请重试', icon: 'none' })
    }
  },

  retry() {
    void this.loadFavorites('refresh')
  },

  async loadFavorites(mode: 'refresh' | 'append') {
    const token = ++requestToken
    this.setData(mode === 'append'
      ? { loadingMore: true, errorMessage: '' }
      : {
        state: 'loading', errorMessage: '', nextCursor: null, hasMore: true, items: [], cards: [],
        emptyCopy: this.data.activeGroupId
          ? { title: '这个分组还没有球员', detail: '从全部收藏中选择球员，点击卡片下方的分组名称即可移入。' }
          : favoritePageCopy('empty'),
      })
    const query = buildFavoriteQuery({
      keyword: this.data.keyword,
      groupId: this.data.activeGroupId || undefined,
      cursor: mode === 'append' ? this.data.nextCursor ?? undefined : undefined,
      limit: 20,
    } satisfies PlayerFavoriteListQuery, mode === 'refresh')
    try {
      const response = await favoritesApi.list(query)
      if (unloaded || token !== requestToken) return
      const next = nextFavoritePageState({
        items: this.data.items,
        cards: this.data.cards,
        nextCursor: this.data.nextCursor,
        hasMore: this.data.hasMore,
        errorMessage: this.data.errorMessage,
      }, response, mode)
      this.setData({ state: 'loaded', ...next })
    } catch (error) {
      if (unloaded || token !== requestToken) return
      if (error instanceof ApiError && error.statusCode === 401) {
        wx.redirectTo({ url: '/pages/login/index' })
        return
      }
      this.setData({
        state: mode === 'append' ? 'loaded' : 'error',
        errorMessage: error instanceof ApiError ? error.message : favoritePageCopy('error').detail,
      })
    } finally {
      if (!unloaded && token === requestToken) this.setData({ loadingMore: false })
    }
  },
})
