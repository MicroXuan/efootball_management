import type { CupBracketView } from '@efm/contracts'
import { competitionsApi } from '../../services/competitions'
import { panoramaBoard, type PanoramaRound } from './panorama.viewmodel'

const MIN_SCALE = 0.6
const MAX_SCALE = 1.6
const SCALE_STEP = 0.2
const DEFAULT_SCALE = 0.8

Page({
  data: {
    id: '',
    loading: true,
    errorMessage: '',
    competitionName: '',
    bracket: null as CupBracketView | null,
    rounds: [] as PanoramaRound[],
    boardWidth: 0,
    boardHeight: 0,
    scale: DEFAULT_SCALE,
  },

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ id: options.id ?? '' })
    void this.load()
  },

  retry() { void this.load() },

  async load() {
    if (!this.data.id) {
      this.setData({ loading: false, errorMessage: '缺少杯赛信息，无法打开全景签表。' })
      return
    }
    this.setData({ loading: true, errorMessage: '' })
    try {
      const [detail, bracket, participants] = await Promise.all([
        competitionsApi.detail(this.data.id),
        competitionsApi.bracket(this.data.id),
        competitionsApi.cupParticipants(this.data.id),
      ])
      const board = panoramaBoard(bracket, participants)
      wx.setNavigationBarTitle({ title: `${detail.name} · 全景签表` })
      this.setData({
        competitionName: detail.name,
        bracket,
        rounds: board.rounds,
        boardWidth: board.width,
        boardHeight: board.height,
        errorMessage: bracket ? '' : '淘汰签表尚未生成。',
      })
    } catch {
      this.setData({ errorMessage: '全景签表加载失败，请稍后重试。' })
    } finally {
      this.setData({ loading: false })
    }
  },

  zoomIn() {
    this.setData({ scale: Math.min(MAX_SCALE, Number((this.data.scale + SCALE_STEP).toFixed(1))) })
  },

  zoomOut() {
    this.setData({ scale: Math.max(MIN_SCALE, Number((this.data.scale - SCALE_STEP).toFixed(1))) })
  },

  trackScale(event: { detail: { scale: number } }) {
    this.setData({ scale: Number(event.detail.scale.toFixed(2)) })
  },

  resetViewport() { this.setData({ scale: DEFAULT_SCALE }) },
})
