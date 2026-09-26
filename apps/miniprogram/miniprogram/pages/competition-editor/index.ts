import type { CompetitionDetail, GamePlatform, ParsedCreateCompetitionRequest, UpdateCompetitionRequest } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { competitionsApi } from '../../services/competitions'
import { canEditCoreFields, validateTimeline } from './editor.viewmodel'

type InputEvent = { currentTarget: { dataset: { field?: string } }; detail: { value: string } }

function futureIso(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString()
}

Page({
  data: {
    id: '', loading: false, saving: false, errorMessage: '', version: 1, status: 'DRAFT', coreEditable: true,
    name: '', description: '', platform: 'MOBILE' as GamePlatform, serverRegion: 'GLOBAL', participantLimit: '16',
    registrationOpensAt: new Date().toISOString(), registrationClosesAt: futureIso(7), startsAt: futureIso(8), endsAt: futureIso(30),
  },
  onLoad(options: Record<string, string | undefined>) {
    const id = options.id ?? ''
    this.setData({ id })
    if (id) void this.load()
  },
  onInput(event: InputEvent) {
    const field = event.currentTarget.dataset.field
    if (field) this.setData({ [field]: event.detail.value })
  },
  onPlatformChange(event: { detail: { value: string } }) {
    this.setData({ platform: Number(event.detail.value) === 0 ? 'MOBILE' : 'PLAYSTATION' })
  },
  async load() {
    this.setData({ loading: true, errorMessage: '' })
    try {
      const detail = await competitionsApi.managerDetail(this.data.id)
      this.setData({
        version: detail.version, status: detail.status, coreEditable: canEditCoreFields(detail.status),
        name: detail.name, description: detail.description, platform: detail.platform,
        serverRegion: detail.serverRegion, participantLimit: String(detail.participantLimit),
        registrationOpensAt: detail.registrationOpensAt, registrationClosesAt: detail.registrationClosesAt,
        startsAt: detail.startsAt, endsAt: detail.endsAt,
      })
    } catch (error) { this.setData({ errorMessage: this.errorCopy(error) }) }
    finally { this.setData({ loading: false }) }
  },
  async save() {
    if (this.data.saving) return
    const timestamps = [this.data.registrationOpensAt, this.data.registrationClosesAt, this.data.startsAt, this.data.endsAt]
    if (timestamps.some((value) => Number.isNaN(Date.parse(value)))) {
      this.setData({ errorMessage: '时间格式无效，请使用完整 ISO 时间，例如 2026-10-01T12:00:00.000Z' }); return
    }
    const timelineError = validateTimeline({ opens: Date.parse(timestamps[0]), closes: Date.parse(timestamps[1]), starts: Date.parse(timestamps[2]), ends: Date.parse(timestamps[3]) })
    const participantLimit = Number(this.data.participantLimit)
    if (!this.data.name.trim() || !this.data.serverRegion.trim()) {
      this.setData({ errorMessage: '请填写赛事名称和区服' }); return
    }
    if (!Number.isInteger(participantLimit) || participantLimit < 2 || participantLimit > 128) {
      this.setData({ errorMessage: '参赛人数须为 2 到 128 的整数' }); return
    }
    if (timelineError) { this.setData({ errorMessage: timelineError }); return }
    this.setData({ saving: true, errorMessage: '' })
    try {
      const core = {
        name: this.data.name.trim(), description: this.data.description.trim(), platform: this.data.platform,
        serverRegion: this.data.serverRegion.trim(), participantType: 'INDIVIDUAL' as const,
        format: 'ROUND_ROBIN' as const, participantLimit,
        registrationOpensAt: this.data.registrationOpensAt, registrationClosesAt: this.data.registrationClosesAt,
        startsAt: this.data.startsAt, endsAt: this.data.endsAt,
      }
      let detail: CompetitionDetail
      if (this.data.id) {
        detail = await competitionsApi.update(this.data.id, { ...core, expectedVersion: this.data.version } as UpdateCompetitionRequest)
      } else {
        detail = await competitionsApi.create(core as ParsedCreateCompetitionRequest)
      }
      wx.showToast({ title: '赛事已保存', icon: 'success' })
      wx.redirectTo({ url: `/pages/competition-manage/index?id=${encodeURIComponent(detail.id)}` })
    } catch (error) { this.setData({ errorMessage: this.errorCopy(error) }) }
    finally { this.setData({ saving: false }) }
  },
  errorCopy(error: unknown) {
    if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') return '赛事已被其他管理员更新，请返回后重新进入'
    return error instanceof ApiError ? error.message : '保存失败，请检查网络后重试'
  },
})
