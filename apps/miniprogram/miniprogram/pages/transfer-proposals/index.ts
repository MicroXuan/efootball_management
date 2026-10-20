import type { TransferProposal } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { leagueTeamsApi } from '../../services/league-teams'
import { playerRequestsApi } from '../../services/player-requests'

type ProposalView = TransferProposal & { statusCopy: string; canRespond: boolean; canWithdraw: boolean }
const key = () => `transfer-reply-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`

Page({
  data: { state: 'loading' as 'loading'|'loaded'|'error', errorMessage: '', seasonId: '', myTeamId: '',
    items: [] as ProposalView[], busyId: '' },
  onLoad(options: { seasonId?: string }) {
    if (!options.seasonId) this.setData({ state: 'error', errorMessage: '缺少赛季参数' })
    else this.setData({ seasonId: options.seasonId })
  },
  onShow() { if (this.data.seasonId) void this.load() },
  onPullDownRefresh() { void this.load().finally(() => wx.stopPullDownRefresh()) },
  async load() {
    this.setData({ state: 'loading', errorMessage: '' })
    try {
      const [mine, response] = await Promise.all([leagueTeamsApi.mine(), playerRequestsApi.listTransfers(this.data.seasonId)])
      const myTeamId = mine.items.find((team) => team.currentSeason?.id === this.data.seasonId)?.id ?? ''
      const labels: Record<string, string> = { PENDING_COUNTERPARTY: '待对方确认', PENDING_ADMIN: '待管理员终审', APPROVED: '已完成', REJECTED: '已驳回', WITHDRAWN: '已撤回', EXPIRED: '已过期', INVALIDATED: '归属已变化' }
      const items = response.items.map((item) => ({ ...item, statusCopy: labels[item.status] ?? item.status,
        canRespond: item.status === 'PENDING_COUNTERPARTY' && item.initiatorTeamId !== myTeamId && (item.sourceTeamId === myTeamId || item.targetTeamId === myTeamId),
        canWithdraw: item.status === 'PENDING_COUNTERPARTY' && item.initiatorTeamId === myTeamId }))
      this.setData({ state: 'loaded', myTeamId, items })
    } catch (error) { this.setData({ state: 'error', errorMessage: error instanceof ApiError ? error.message : '转会申请加载失败' }) }
  },
  respond(event: { currentTarget: { dataset: { id?: string; decision?: 'CONFIRM'|'REJECT'|'WITHDRAW' } } }) {
    const id = event.currentTarget.dataset.id
    const decision = event.currentTarget.dataset.decision
    const item = this.data.items.find((proposal) => proposal.id === id)
    if (!item || !decision || this.data.busyId) return
    wx.showModal({ title: decision === 'CONFIRM' ? '确认协商转会？' : decision === 'REJECT' ? '驳回转会？' : '撤回申请？',
      content: `${item.playerName} · ${item.sourceTeamName} → ${item.targetTeamName} · 报价 ${item.amountMinor}。确认后仍需管理员终审。`,
      confirmText: decision === 'CONFIRM' ? '确认报价' : decision === 'REJECT' ? '驳回' : '撤回',
      success: ({ confirm }) => { if (confirm) void this.submitResponse(item, decision) } })
  },
  async submitResponse(item: ProposalView, decision: 'CONFIRM'|'REJECT'|'WITHDRAW') {
    this.setData({ busyId: item.id, errorMessage: '' })
    try {
      await playerRequestsApi.respondTransfer(item.id, { decision, expectedVersion: item.version }, key())
      await this.load()
      wx.showToast({ title: decision === 'CONFIRM' ? '已确认，等待终审' : '已处理', icon: 'success' })
    } catch (error) { this.setData({ errorMessage: error instanceof ApiError ? error.message : '操作失败，请刷新重试' }); await this.load() }
    finally { this.setData({ busyId: '' }) }
  },
})
