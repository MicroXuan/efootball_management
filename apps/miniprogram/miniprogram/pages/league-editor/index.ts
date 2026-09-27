import type { GamePlatform, LeagueDetail } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { leaguesApi } from '../../services/leagues'
import {
  buildLeagueForm,
  isLeagueFormValid,
  leagueEditorErrorMessage,
  leagueEditorMode,
  type LeagueForm,
} from './editor.viewmodel'

type InputEvent = { currentTarget: { dataset: { field?: keyof LeagueForm } }; detail: { value: string } }
type PickerEvent = { detail: { value: string } }

const platformOptions: Array<{ value: GamePlatform; label: string }> = [
  { value: 'MOBILE', label: '移动端' },
  { value: 'PLAYSTATION', label: 'PlayStation' },
  { value: 'XBOX', label: 'Xbox' },
  { value: 'STEAM', label: 'Steam' },
]

Page({
  data: {
    id: '',
    state: 'loaded' as 'loading' | 'loaded' | 'error',
    errorMessage: '',
    saving: false,
    league: null as LeagueDetail | null,
    form: buildLeagueForm(null) as LeagueForm,
    title: leagueEditorMode(null).title,
    actionLabel: leagueEditorMode(null).action,
    canSave: false,
    platformLabels: platformOptions.map(({ label }) => label),
    platformIndex: 0,
    platformLabel: platformOptions[0].label,
  },

  onLoad(options: { id?: string }) {
    const id = options.id ?? ''
    this.setData({ id })
    if (id) void this.loadLeague()
  },

  async loadLeague() {
    this.setData({ state: 'loading', errorMessage: '' })
    try {
      const league = await leaguesApi.managerLeague(this.data.id)
      const form = buildLeagueForm(league)
      const mode = leagueEditorMode(league)
      const platformIndex = Math.max(0, platformOptions.findIndex(({ value }) => value === form.defaultPlatform))
      this.setData({
        state: 'loaded', league, form, title: mode.title, actionLabel: mode.action,
        canSave: isLeagueFormValid(form), platformIndex, platformLabel: platformOptions[platformIndex].label,
      })
    } catch (error) {
      this.setData({ state: 'error', errorMessage: this.errorCopy(error).message })
    }
  },

  onInput(event: InputEvent) {
    const field = event.currentTarget.dataset.field
    if (!field) return
    this.updateForm({ [field]: event.detail.value })
  },

  onPlatformChange(event: PickerEvent) {
    const platformIndex = Number(event.detail.value)
    const option = platformOptions[platformIndex]
    if (!option) return
    this.setData({ platformIndex, platformLabel: option.label })
    this.updateForm({ defaultPlatform: option.value })
  },

  updateForm(change: Partial<LeagueForm>) {
    const form = { ...this.data.form, ...change }
    this.setData({ form, canSave: isLeagueFormValid(form) })
  },

  async save() {
    if (this.data.saving || !this.data.canSave) return
    this.setData({ saving: true, errorMessage: '' })
    const form = this.data.form
    const input = {
      name: form.name.trim(), shortName: form.shortName.trim(), description: form.description.trim(),
      logoUrl: form.logoUrl.trim() || null, defaultPlatform: form.defaultPlatform,
      defaultServerRegion: form.defaultServerRegion.trim(),
      defaultSuperCapacity: Number(form.defaultSuperCapacity),
      defaultChampionCapacity: Number(form.defaultChampionCapacity),
      defaultPromotionCount: Number(form.defaultPromotionCount),
    }
    try {
      const league = this.data.league
        ? await leaguesApi.updateLeague(this.data.id, { ...input, expectedVersion: this.data.league.version })
        : await leaguesApi.createLeague(input)
      wx.showToast({ title: this.data.league ? '联赛规则已保存' : '联赛已创建', icon: 'success' })
      if (!this.data.league) {
        wx.redirectTo({ url: `/pages/season-manage/index?leagueId=${encodeURIComponent(league.id)}` })
      } else {
        const formAfterSave = buildLeagueForm(league)
        this.setData({ league, form: formAfterSave, canSave: true })
      }
    } catch (error) {
      const result = this.errorCopy(error)
      this.setData({ errorMessage: result.message })
      if (result.refresh) await this.loadLeague()
    } finally {
      this.setData({ saving: false })
    }
  },

  errorCopy(error: unknown) {
    return leagueEditorErrorMessage(error instanceof ApiError ? error.code : 'UNKNOWN')
  },
})
