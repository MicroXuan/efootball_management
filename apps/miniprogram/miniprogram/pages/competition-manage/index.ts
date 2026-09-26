import type { CompetitionDetail, CompetitionMatchResponse, CompetitionRegistrationResponse } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { competitionsApi, type SchedulePreview } from '../../services/competitions'
import { formatLocalDate, lifecycleLabel } from '../competitions/competitions.viewmodel'
import { canCancelCompetition, groupScheduleByRound, reviewReasonRequired } from '../competition-editor/editor.viewmodel'
import { validateScore } from '../match-result/result.viewmodel'

type DatasetEvent = { currentTarget: { dataset: { id?: string; version?: number; action?: string } } }
type InputEvent = { detail: { value: string } }

function actionFor(status: CompetitionDetail['status']): { key: 'open-registration' | 'close-registration' | 'start' | 'complete'; label: string } | null {
  if (status === 'DRAFT') return { key: 'open-registration', label: '开放报名' }
  if (status === 'REGISTRATION_OPEN') return { key: 'close-registration', label: '关闭报名' }
  if (status === 'SCHEDULED') return { key: 'start', label: '开始赛事' }
  if (status === 'IN_PROGRESS') return { key: 'complete', label: '完成赛事' }
  return null
}

Page({
  data: {
    id: '', loading: true, acting: false, errorMessage: '', detail: null as CompetitionDetail | null,
    lifecycleName: '', lifecycleAction: null as ReturnType<typeof actionFor>, cancelAllowed: false, cancelReason: '',
    registrations: [] as CompetitionRegistrationResponse[], pendingRegistrations: [] as CompetitionRegistrationResponse[],
    rejectReason: '', schedule: null as SchedulePreview | null,
    roundGroups: [] as Array<{ roundNumber: number; matches: CompetitionMatchResponse[] }>,
    matches: [] as CompetitionMatchResponse[], selectedMatchId: '', homeScore: '', awayScore: '', correctionReason: '',
  },
  onLoad(options: Record<string, string | undefined>) { this.setData({ id: options.id ?? '' }); void this.load() },
  onPullDownRefresh() { void this.load(false).finally(() => wx.stopPullDownRefresh()) },
  onRejectReasonInput(event: InputEvent) { this.setData({ rejectReason: event.detail.value }) },
  onCancelReasonInput(event: InputEvent) { this.setData({ cancelReason: event.detail.value }) },
  onHomeInput(event: InputEvent) { this.setData({ homeScore: event.detail.value }) },
  onAwayInput(event: InputEvent) { this.setData({ awayScore: event.detail.value }) },
  onCorrectionReasonInput(event: InputEvent) { this.setData({ correctionReason: event.detail.value }) },
  edit() { wx.navigateTo({ url: `/pages/competition-editor/index?id=${encodeURIComponent(this.data.id)}` }) },
  selectMatch(event: DatasetEvent) {
    const id = event.currentTarget.dataset.id
    const match = this.data.matches.find((item) => item.id === id)
    if (match) this.setData({ selectedMatchId: match.id, homeScore: match.officialResult ? String(match.officialResult.homeScore) : '', awayScore: match.officialResult ? String(match.officialResult.awayScore) : '', correctionReason: '' })
  },
  async load(showLoading = true) {
    if (!this.data.id) return
    if (showLoading) this.setData({ loading: true, errorMessage: '' })
    try {
      const [detail, registrations, matches] = await Promise.all([
        competitionsApi.managerDetail(this.data.id), competitionsApi.registrations(this.data.id), competitionsApi.matches(this.data.id),
      ])
      let schedule: SchedulePreview | null = null
      try { schedule = await competitionsApi.schedulePreview(this.data.id) }
      catch (error) { if (!(error instanceof ApiError) || error.statusCode !== 404) throw error }
      this.setData({
        detail, lifecycleName: lifecycleLabel(detail.status), lifecycleAction: actionFor(detail.status),
        cancelAllowed: canCancelCompetition(detail.status),
        registrations, pendingRegistrations: registrations.filter(({ status }) => status === 'PENDING'),
        schedule, roundGroups: groupScheduleByRound(schedule?.matches ?? []), matches,
        selectedMatchId: this.data.selectedMatchId || matches[0]?.id || '', errorMessage: '',
      })
    } catch (error) { this.setData({ errorMessage: this.errorCopy(error) }) }
    finally { this.setData({ loading: false }) }
  },
  approve(event: DatasetEvent) { void this.review(event, 'approve') },
  reject(event: DatasetEvent) {
    if (reviewReasonRequired('REJECT', this.data.rejectReason)) { this.setData({ errorMessage: '拒绝报名时请先填写审核原因' }); return }
    void this.review(event, 'reject')
  },
  async review(event: DatasetEvent, decision: 'approve' | 'reject') {
    const { id, version } = event.currentTarget.dataset
    if (!id || !version || this.data.acting) return
    await this.run(async () => { await competitionsApi.reviewRegistration(this.data.id, id, decision, version, this.data.rejectReason.trim() || undefined) }, decision === 'approve' ? '报名已通过' : '报名已拒绝')
  },
  generateSchedule() { void this.run(async () => { await competitionsApi.generateSchedule(this.data.id) }, '赛程草稿已生成') },
  publishSchedule() {
    const detail = this.data.detail, schedule = this.data.schedule
    if (!detail || !schedule || schedule.status === 'PUBLISHED') return
    wx.showModal({ title: '发布赛程', content: `将发布 ${schedule.roundCount} 轮、${schedule.matchCount} 场比赛。发布后对所有参赛者可见。`, confirmText: '确认发布',
      success: ({ confirm }) => { if (confirm) void this.run(async () => { await competitionsApi.publishSchedule(this.data.id, detail.version, schedule.version) }, '赛程已发布') } })
  },
  transition() {
    const detail = this.data.detail, action = this.data.lifecycleAction
    if (!detail || !action) return
    wx.showModal({ title: action.label, content: `确认将赛事从“${this.data.lifecycleName}”推进到下一阶段？`, confirmText: '确认',
      success: ({ confirm }) => { if (confirm) void this.run(async () => { await competitionsApi.transition(this.data.id, action.key, detail.version) }, '赛事状态已更新') } })
  },
  cancel() {
    const detail = this.data.detail, reason = this.data.cancelReason.trim()
    if (!detail || !this.data.cancelAllowed) return
    if (!reason) { this.setData({ errorMessage: '取消赛事前必须填写原因' }); return }
    wx.showModal({
      title: '取消赛事',
      content: `确认取消“${detail.name}”？该操作会终止赛事，原因将保留在审计记录中。`,
      confirmText: '确认取消', confirmColor: '#d96656',
      success: ({ confirm }) => {
        if (confirm) void this.run(async () => { await competitionsApi.cancel(this.data.id, detail.version, reason) }, '赛事已取消')
      },
    })
  },
  correctResult() {
    const match = this.data.matches.find(({ id }) => id === this.data.selectedMatchId)
    const homeScore = validateScore(this.data.homeScore), awayScore = validateScore(this.data.awayScore)
    if (!match || homeScore === null || awayScore === null) { this.setData({ errorMessage: '请选择比赛并填写 0 到 99 的整数比分' }); return }
    if (match.officialResult && !this.data.correctionReason.trim()) { this.setData({ errorMessage: '修改已有官方比分时必须填写修正原因' }); return }
    const content = match.officialResult ? `将官方比分改为 ${homeScore}:${awayScore}，原记录会保留在审计历史中。` : `确认录入官方比分 ${homeScore}:${awayScore}？`
    wx.showModal({ title: match.officialResult ? '修正官方比分' : '录入官方比分', content, confirmText: '确认提交',
      success: ({ confirm }) => { if (confirm) void this.run(async () => { await competitionsApi.managerResult(this.data.id, match.id, { homeScore, awayScore, expectedVersion: match.version, reason: this.data.correctionReason.trim() || null }) }, '官方比分已更新') } })
  },
  async run(work: () => Promise<void>, successTitle: string) {
    if (this.data.acting) return
    this.setData({ acting: true, errorMessage: '' })
    try { await work(); wx.showToast({ title: successTitle, icon: 'success' }); await this.load(false) }
    catch (error) {
      const message = this.errorCopy(error)
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') await this.load(false)
      this.setData({ errorMessage: message })
    }
    finally { this.setData({ acting: false }) }
  },
  errorCopy(error: unknown) {
    if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') return '数据已被其他操作更新，页面已重新加载，请再次确认'
    return error instanceof ApiError ? error.message : '操作失败，请检查网络后重试'
  },
  formatDate(value: string | null) { return value ? formatLocalDate(value) : '待定' },
})
