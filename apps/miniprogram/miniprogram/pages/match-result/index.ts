import type { MyMatchResponse, ParticipantMatchResultDisputeResponse } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { competitionsApi } from '../../services/competitions'
import { createEvidenceUpload, completeEvidenceUpload, chooseAndCompressEvidence, uploadEvidenceGrant, type SelectedEvidence } from '../../services/result-evidence'
import { session } from '../../services/session'
import { nextResultForm, resultView, validateScore, type ResultState } from './result.viewmodel'

type InputEvent = { detail: { value: string } }

Page({
  selectedEvidence: null as SelectedEvidence | null,
  loadGeneration: 0,
  clockTimer: undefined as ReturnType<typeof setInterval> | undefined,
  data: {
    id: '', loading: true, acting: false, item: null as MyMatchResponse | null,
    dispute: null as ParticipantMatchResultDisputeResponse | null,
    state: 'WAIT_CONFIRM' as ResultState, statusLabel: '', scoreCopy: '— : —', deadlineCopy: '',
    myRole: null as 'SUBMITTER' | 'OPPONENT' | null,
    canOpenTimeout: false, canUploadEvidence: false, canReplaceEvidence: false,
    canvasWidth: 1, canvasHeight: 1,
    evidenceStatus: { submitter: '未提交', opponent: '未提交' },
    timeline: [] as Array<{ label: string; at: string; reason: string }>,
    homeScore: '', awayScore: '', reason: '', evidenceSelected: false, evidenceSizeCopy: '',
    errorMessage: '', reloadRequired: false
  },
  onLoad(options: Record<string, string | undefined>) { this.setData({ id: options.id ?? '' }); void this.load() },
  onShow() {
    if (this.data.id && this.data.item && !this.data.acting && !this.data.loading) void this.load()
    this.stopClock()
    this.clockTimer = setInterval(() => this.refreshView(), 30_000)
  },
  onHide() { this.stopClock() },
  onUnload() { this.stopClock() },
  stopClock() { if (this.clockTimer) clearInterval(this.clockTimer); this.clockTimer = undefined },
  onHomeInput(event: InputEvent) { if (!this.data.loading && !this.data.acting) this.setData({ homeScore: event.detail.value }) },
  onAwayInput(event: InputEvent) { if (!this.data.loading && !this.data.acting) this.setData({ awayScore: event.detail.value }) },
  onReasonInput(event: InputEvent) { if (!this.data.loading && !this.data.acting) this.setData({ reason: event.detail.value }) },
  retry() { if (this.data.loading || this.data.acting) return undefined; return this.load() },
  refreshView() { if (this.data.item) this.setData(resultView(this.data.item, this.data.dispute)) },
  async load(preserveError = false) {
    if (!this.data.id) { this.setData({ loading: false, errorMessage: '缺少比赛编号' }); return }
    const generation = ++this.loadGeneration
    this.setData({ loading: true })
    try {
      let cursor: string | undefined
      let item: MyMatchResponse | null = null
      do {
        const page = await competitionsApi.myMatches({ cursor, limit: 100 })
        if (generation !== this.loadGeneration) return
        item = page.items.find(({ match }) => match.id === this.data.id) ?? null
        cursor = page.nextCursor ?? undefined
      } while (!item && cursor)
      const dispute = item?.disputeSummary ? await competitionsApi.resultDispute(item.match.id) : null
      if (generation !== this.loadGeneration) return
      this.setData({ item, dispute, errorMessage: item ? (preserveError ? this.data.errorMessage : '') : '比赛不存在或已不可操作', reloadRequired: false })
      this.refreshView()
    } catch (error) { if (generation === this.loadGeneration) this.setData({ errorMessage: error instanceof ApiError ? error.message : '比赛加载失败，请稍后重试' }) }
    finally { if (generation === this.loadGeneration) this.setData({ loading: false }) }
  },
  async chooseEvidence() {
    if (this.data.acting || this.data.loading) return
    this.setData({ acting: true, errorMessage: '' })
    try {
      this.selectedEvidence = await chooseAndCompressEvidence((width, height) => new Promise((resolve) => {
        this.setData({ canvasWidth: width, canvasHeight: height }, () => wx.nextTick(resolve))
      }))
      this.setData({ evidenceSelected: true, evidenceSizeCopy: `${Math.ceil(this.selectedEvidence.byteSize / 1024)} KB · 已准备上传` })
    } catch (error) { this.setData({ errorMessage: error instanceof Error ? error.message : '图片处理失败，请重新选择' }) }
    finally { this.setData({ acting: false }) }
  },
  async uploadSelected(role: 'SUBMITTER' | 'OPPONENT', matchId: string, expectedVersion: number): Promise<string> {
    const selected = this.selectedEvidence
    if (!selected) throw new Error('请先选择一张比赛截图')
    const grant = await createEvidenceUpload(matchId, {
      role, mimeType: selected.mimeType, byteSize: selected.byteSize,
      checksumSha256: selected.checksumSha256, expectedVersion
    })
    await uploadEvidenceGrant(grant, selected.bytes, session.getAccessToken())
    await completeEvidenceUpload(matchId, grant.id, { expectedVersion })
    return grant.id
  },
  async submit() {
    if (this.data.acting || this.data.loading || this.data.state !== 'SUBMIT') return
    const item = this.data.item
    const homeScore = validateScore(this.data.homeScore), awayScore = validateScore(this.data.awayScore)
    if (!item || homeScore === null || awayScore === null) { this.setData({ errorMessage: '请输入 0 到 99 的整数比分' }); return }
    if (item.evidenceRequired && !this.selectedEvidence) { this.setData({ errorMessage: '请先选择比赛截图' }); return }
    await this.act(async () => {
      const evidenceUploadId = item.evidenceRequired ? await this.uploadSelected('SUBMITTER', item.match.id, item.match.version) : undefined
      await competitionsApi.submitResult(item.match.id, { homeScore, awayScore, expectedVersion: item.match.version,
        ...(evidenceUploadId ? { evidenceUploadId } : {}) })
    }, '比分已提交')
  },
  confirm() {
    const item = this.data.item, proposal = item?.actionableResultVersion
    if (this.data.acting || this.data.loading || this.data.state !== 'CONFIRM' || !item || !proposal) return
    void this.act(() => competitionsApi.confirmResult(item.match.id, proposal.version, item.match.version), '比分已确认')
  },
  reject() {
    const item = this.data.item, proposal = item?.actionableResultVersion
    if (this.data.acting || this.data.loading || this.data.state !== 'CONFIRM' || !item || !proposal) return
    const reason = this.data.reason.trim()
    if (!reason) { this.setData({ errorMessage: '请填写拒绝原因，提交后将进入证据收集' }); return }
    void this.act(() => competitionsApi.rejectResult(item.match.id, proposal.version, { expectedVersion: item.match.version, reason }), '已拒绝，进入证据收集')
  },
  async openTimeout() {
    const item = this.data.item
    if (this.data.acting || this.data.loading || !item || !this.data.canOpenTimeout) return
    if (!this.selectedEvidence) { this.setData({ errorMessage: '请先选择比赛截图' }); return }
    await this.act(async () => {
      const uploadId = await this.uploadSelected('SUBMITTER', item.match.id, item.match.version)
      await competitionsApi.openTimeoutDispute(item.match.id, uploadId, item.match.version)
    }, '争议已申请')
  },
  async attachEvidence() {
    const item = this.data.item, role = this.data.myRole
    if (this.data.acting || this.data.loading || !item || !this.data.canUploadEvidence || !role) return
    if (!this.selectedEvidence) { this.setData({ errorMessage: '请先选择比赛截图' }); return }
    await this.act(async () => {
      const version = this.data.dispute?.matchVersion ?? item.match.version
      const uploadId = await this.uploadSelected(role, item.match.id, version)
      await competitionsApi.attachResultEvidence(item.match.id, uploadId, version)
    }, '证据已提交')
  },
  async act(work: () => Promise<unknown>, successCopy: string) {
    if (this.data.acting || this.data.loading) return
    this.setData({ acting: true, errorMessage: '' })
    try {
      await work()
      this.selectedEvidence = null
      this.setData({ evidenceSelected: false, evidenceSizeCopy: '' })
      wx.showToast({ title: successCopy, icon: 'success' })
      await this.load()
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'REQUEST_FAILED'
      const next = nextResultForm({ homeScore: this.data.homeScore, awayScore: this.data.awayScore }, code)
      this.setData({ ...next, errorMessage: code === 'VERSION_CONFLICT' ? '比赛状态已更新，请核对比分或原因后重试' : error instanceof Error ? error.message : next.errorMessage })
      if (next.reloadRequired) await this.load(true)
    } finally { this.setData({ acting: false }) }
  }
})
