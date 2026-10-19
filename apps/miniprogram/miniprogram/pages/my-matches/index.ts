import type { LeagueSeasonSummary, SeasonFixtureStatus } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { competitionsApi } from '../../services/competitions'
import { leaguesApi } from '../../services/leagues'
import { competitionErrorMessage } from '../competitions/competitions.viewmodel'
import { matchCard, seasonOptions } from './matches.viewmodel'

type LoadOptions = { leagueId?: string; seasonId?: string }
type LoadMode = 'replace' | 'append'
type FixtureCard = ReturnType<typeof matchCard>

type FixturePage = {
  data: {
    loading: boolean
    loadingMore: boolean
    errorMessage: string
    leagueId: string
    seasonId: string
    seasons: LeagueSeasonSummary[]
    seasonChoices: Array<{ id: string; label: string }>
    seasonLabels: string[]
    selectedSeasonIndex: number
    status: SeasonFixtureStatus
    teamInput: string
    teamKeyword: string
    items: FixtureCard[]
    nextCursor: string
  }
  setData(update: Record<string, unknown>): void
}

let requestGeneration = 0
let unloaded = false

function requestSignature(page: FixturePage) {
  return `${page.data.seasonId}\0${page.data.status}\0${page.data.teamKeyword}`
}

async function loadFixtures(page: FixturePage, mode: LoadMode = 'replace') {
  const { leagueId, seasonId } = page.data
  if (!leagueId || !seasonId) {
    page.setData({ loading: false, loadingMore: false })
    return
  }

  const append = mode === 'append'
  const generation = append ? requestGeneration : ++requestGeneration
  const signature = requestSignature(page)
  page.setData(append
    ? { loadingMore: true, errorMessage: '' }
    : { loading: true, loadingMore: false, errorMessage: '', items: [], nextCursor: '' })

  try {
    const response = await competitionsApi.seasonFixtures(leagueId, seasonId, {
      team: page.data.teamKeyword || undefined,
      status: page.data.status,
      cursor: append ? page.data.nextCursor || undefined : undefined,
      limit: 20,
    })
    if (unloaded || generation !== requestGeneration || signature !== requestSignature(page)) return
    const incoming = response.items.map(matchCard)
    page.setData({
      items: append ? [...page.data.items, ...incoming] : incoming,
      nextCursor: response.nextCursor ?? '',
      errorMessage: '',
    })
  } catch (error) {
    if (unloaded || generation !== requestGeneration || signature !== requestSignature(page)) return
    page.setData({ errorMessage: competitionErrorMessage(error instanceof ApiError ? error : {}) })
  } finally {
    if (!unloaded && generation === requestGeneration && signature === requestSignature(page)) {
      page.setData({ loading: false, loadingMore: false })
    }
  }
}

async function initialize(page: FixturePage) {
  page.setData({ loading: true, errorMessage: '' })
  try {
    const seasons = page.data.leagueId ? await leaguesApi.seasons(page.data.leagueId) : []
    const choices = seasonOptions(seasons, page.data.seasonId)
    page.setData({
      seasons,
      seasonChoices: choices.items,
      seasonLabels: choices.items.map(({ label }) => label),
      selectedSeasonIndex: choices.selectedIndex,
      seasonId: choices.selectedSeasonId || page.data.seasonId,
    })
    await loadFixtures(page)
  } catch (error) {
    page.setData({
      loading: false,
      errorMessage: competitionErrorMessage(error instanceof ApiError ? error : {}),
    })
  }
}

Page({
  data: {
    loading: true,
    loadingMore: false,
    errorMessage: '',
    leagueId: '',
    seasonId: '',
    seasons: [] as LeagueSeasonSummary[],
    seasonChoices: [] as Array<{ id: string; label: string }>,
    seasonLabels: [] as string[],
    selectedSeasonIndex: 0,
    status: 'ALL' as SeasonFixtureStatus,
    teamInput: '',
    teamKeyword: '',
    items: [] as FixtureCard[],
    nextCursor: '',
  },
  onLoad(options: LoadOptions) {
    unloaded = false
    this.setData({ leagueId: options.leagueId ?? '', seasonId: options.seasonId ?? '' })
    void initialize(this as unknown as FixturePage)
  },
  onUnload() {
    unloaded = true
    requestGeneration += 1
  },
  onPullDownRefresh() {
    void loadFixtures(this as unknown as FixturePage).finally(() => wx.stopPullDownRefresh())
  },
  retry() {
    const page = this as unknown as FixturePage
    void loadFixtures(page, page.data.items.length && page.data.nextCursor ? 'append' : 'replace')
  },
  onTeamInput(event: { detail: { value: string } }) {
    this.setData({ teamInput: event.detail.value })
  },
  search() {
    const teamKeyword = this.data.teamInput.trim()
    this.setData({ teamKeyword })
    void loadFixtures(this as unknown as FixturePage)
  },
  changeStatus(event: { currentTarget: { dataset: { status: SeasonFixtureStatus } } }) {
    const status = event.currentTarget.dataset.status
    if (!status || status === this.data.status) return
    this.setData({ status })
    void loadFixtures(this as unknown as FixturePage)
  },
  changeSeason(event: { detail: { value: string } }) {
    const selectedSeasonIndex = Number(event.detail.value)
    const seasonId = this.data.seasonChoices[selectedSeasonIndex]?.id
    if (!seasonId || seasonId === this.data.seasonId) return
    this.setData({ selectedSeasonIndex, seasonId })
    void loadFixtures(this as unknown as FixturePage)
  },
  load() {
    return loadFixtures(this as unknown as FixturePage)
  },
  loadMore() {
    if (this.data.loadingMore || !this.data.nextCursor) return
    return loadFixtures(this as unknown as FixturePage, 'append')
  },
})
