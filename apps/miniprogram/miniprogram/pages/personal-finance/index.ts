import type { PersonalFinanceEntry, PersonalFinanceList } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { economyApi } from '../../services/economy'

type Direction = 'CREDIT' | 'DEBIT'
const today = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
const money = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

Page({
  data: {
    teamId: '', seasonId: '',
    personalState: 'loading' as 'loading' | 'loaded' | 'error', personalErrorMessage: '',
    personal: null as PersonalFinanceList | null,
    personalEntries: [] as Array<PersonalFinanceEntry & { amountCopy: string }>,
    editingId: '', editingVersion: 0, direction: 'DEBIT' as Direction,
    title: '', amount: '', note: '', occurredOn: today(), saving: false,
  },
  onLoad(options: { teamId?: string; seasonId?: string }) {
    if (!options.teamId || !options.seasonId) {
      this.setData({ personalState: 'error', personalErrorMessage: '球队或赛季参数缺失' })
      return
    }
    this.setData({ teamId: options.teamId, seasonId: options.seasonId })
    void this.loadPersonal()
  },
  async loadPersonal() {
    if (!this.data.teamId || !this.data.seasonId) return
    this.setData({ personalState: 'loading', personalErrorMessage: '' })
    try {
      const personal = await economyApi.personalFinance(this.data.teamId, this.data.seasonId)
      this.setData({ personalState: 'loaded', personal,
        personalEntries: personal.items.map((item) => ({ ...item, amountCopy: `${item.direction === 'CREDIT' ? '+' : '-'}${money(item.amountMinor)}` })) })
    } catch (error) {
      const personalErrorMessage = error instanceof ApiError && error.statusCode === 404
        ? '个人记账接口尚未发布，请联系管理员。'
        : error instanceof ApiError && error.statusCode >= 500
          ? '记账服务暂不可用，请联系管理员检查服务和数据库迁移。'
          : error instanceof ApiError ? error.message : '个人账本加载失败，请稍后重试。'
      this.setData({ personalState: 'error', personalErrorMessage })
    }
  },
  setDirection(event: WechatMiniprogram.BaseEvent) {
    const direction = event.currentTarget.dataset.direction as Direction
    if (direction === 'CREDIT' || direction === 'DEBIT') this.setData({ direction })
  },
  onTitle(event: { detail: { value: string } }) { this.setData({ title: event.detail.value }) },
  onAmount(event: { detail: { value: string } }) { this.setData({ amount: event.detail.value }) },
  onNote(event: { detail: { value: string } }) { this.setData({ note: event.detail.value }) },
  onDate(event: { detail: { value: string } }) { this.setData({ occurredOn: event.detail.value }) },
  editPersonal(event: WechatMiniprogram.BaseEvent) {
    const entry = this.data.personal?.items.find((item) => item.id === event.currentTarget.dataset.id)
    if (!entry) return
    this.setData({ editingId: entry.id, editingVersion: entry.version, direction: entry.direction,
      title: entry.title, amount: String(entry.amountMinor), note: entry.note, occurredOn: entry.occurredOn })
  },
  resetPersonal() {
    this.setData({ editingId: '', editingVersion: 0, direction: 'DEBIT', title: '', amount: '', note: '', occurredOn: today() })
  },
  async savePersonal() {
    const amountMinor = Number(this.data.amount)
    if (!this.data.title.trim() || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > 4_294_967_295) {
      wx.showToast({ title: '填写名称和正整数金额', icon: 'none' }); return
    }
    if (this.data.saving || !this.data.seasonId) return
    this.setData({ saving: true })
    const input = { seasonId: this.data.seasonId, direction: this.data.direction, amountMinor,
      title: this.data.title.trim(), note: this.data.note.trim(), occurredOn: this.data.occurredOn }
    try {
      if (this.data.editingId) await economyApi.updatePersonalFinance(this.data.teamId, this.data.editingId,
        { ...input, expectedVersion: this.data.editingVersion })
      else await economyApi.addPersonalFinance(this.data.teamId, input)
      this.resetPersonal()
      await this.loadPersonal()
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch { wx.showToast({ title: '保存失败，请刷新后重试', icon: 'none' }) }
    finally { this.setData({ saving: false }) }
  },
  deletePersonal(event: WechatMiniprogram.BaseEvent) {
    const entryId = event.currentTarget.dataset.id as string
    wx.showModal({ title: '删除这笔记录？', content: '仅删除个人账本记录，不影响官方财务。', success: (result) => {
      if (!result.confirm) return
      void economyApi.deletePersonalFinance(this.data.teamId, entryId, this.data.seasonId)
        .then(() => { if (this.data.editingId === entryId) this.resetPersonal(); return this.loadPersonal() })
        .catch(() => wx.showToast({ title: '删除失败，请重试', icon: 'none' }))
    } })
  },
})
