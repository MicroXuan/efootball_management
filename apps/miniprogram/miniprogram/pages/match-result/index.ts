import type { MyMatchResponse } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { competitionsApi } from '../../services/competitions'
import { nextResultForm, validateScore } from './result.viewmodel'

type InputEvent = { detail: { value: string } }

Page({
  data: { id: '', loading: true, acting: false, item: null as MyMatchResponse | null,
    homeScore: '', awayScore: '', reason: '', errorMessage: '', reloadRequired: false },
  onLoad(options: Record<string, string | undefined>) { this.setData({ id: options.id ?? '' }); void this.load() },
  onHomeInput(event: InputEvent) { this.setData({ homeScore: event.detail.value }) },
  onAwayInput(event: InputEvent) { this.setData({ awayScore: event.detail.value }) },
  onReasonInput(event: InputEvent) { this.setData({ reason: event.detail.value }) },
  async load(preserveError = false) {
    this.setData({ loading: true })
    try {
      const response = await competitionsApi.myMatches(undefined, 100)
      const item = response.items.find(({ match }) => match.id === this.data.id) ?? null
      this.setData({ item, errorMessage: item ? (preserveError ? this.data.errorMessage : '') : '比赛不存在或已不可操作', reloadRequired: false })
    } catch (error) {
      this.setData({ errorMessage: error instanceof ApiError ? error.message : '比赛加载失败，请稍后重试' })
    } finally { this.setData({ loading: false }) }
  },
  async submit() {
    const item = this.data.item
    const homeScore = validateScore(this.data.homeScore), awayScore = validateScore(this.data.awayScore)
    if (!item || homeScore === null || awayScore === null || this.data.acting) {
      this.setData({ errorMessage: '请输入 0 到 99 的整数比分' }); return
    }
    await this.act(() => competitionsApi.submitResult(item.match.id, { homeScore, awayScore, expectedVersion: item.match.version }))
  },
  confirm() {
    const item = this.data.item, proposal = item?.actionableResultVersion
    if (!item || !proposal) return
    void this.act(() => competitionsApi.confirmResult(item.match.id, proposal.version, item.match.version))
  },
  reject() {
    const item = this.data.item, proposal = item?.actionableResultVersion
    if (!item || !proposal || !this.data.reason.trim()) { this.setData({ errorMessage: '拒绝比分时请填写原因' }); return }
    void this.act(() => competitionsApi.rejectResult(item.match.id, proposal.version,
      { expectedVersion: item.match.version, reason: this.data.reason.trim() }))
  },
  async act(work: () => Promise<unknown>) {
    this.setData({ acting: true, errorMessage: '' })
    try { await work(); wx.showToast({ title: '操作已完成', icon: 'success' }); await this.load() }
    catch (error) {
      const code = error instanceof ApiError ? error.code : 'REQUEST_FAILED'
      const next = nextResultForm({ homeScore: this.data.homeScore, awayScore: this.data.awayScore }, code)
      this.setData(next)
      if (next.reloadRequired) await this.load(true)
    } finally { this.setData({ acting: false }) }
  },
})
