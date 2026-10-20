import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ move: vi.fn() }))

vi.mock('../../services/favorites', () => ({ favoritesApi: { move: mocks.move } }))

type FavoritePage = {
  data: Record<string, any>
  onOpenGroupPicker(event: { currentTarget: { dataset: { playerId: string } } }): void
  onCloseGroupPicker(): void
  onPickGroup(event: { currentTarget: { dataset: { groupId: string } } }): void
  moveFavorite(playerId: string, groupId: string | null): Promise<void>
}

let page: FavoritePage

beforeAll(async () => {
  vi.stubGlobal('Page', (definition: FavoritePage) => { page = definition })
  vi.stubGlobal('wx', { showToast: vi.fn() })
  await import('./index')
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.move.mockResolvedValue(undefined)
})

function context(groupId: string | null = 'group-1') {
  const instance = {
    data: {
      ...page.data,
      items: [{ playerId: 'player-1', groupId }],
      movingPlayerId: 'player-1',
      movingPlayerHasGroup: Boolean(groupId),
      showGroupPicker: true,
      activeGroupId: 'group-1',
    },
    setData(update: Record<string, unknown>) { Object.assign(this.data, update) },
    loadFavorites: vi.fn(),
    onCloseGroupPicker() { page.onCloseGroupPicker.call(this) },
    moveFavorite: vi.fn(),
  }
  return instance
}

describe('favorite group picker', () => {
  it('offers removal only for a player already in a group', () => {
    const grouped = context()
    page.onOpenGroupPicker.call(grouped, { currentTarget: { dataset: { playerId: 'player-1' } } })
    expect(grouped.data.movingPlayerHasGroup).toBe(true)

    const ungrouped = context(null)
    page.onOpenGroupPicker.call(ungrouped, { currentTarget: { dataset: { playerId: 'player-1' } } })
    expect(ungrouped.data.movingPlayerHasGroup).toBe(false)
  })

  it('maps the remove action to a null group ID', () => {
    const instance = context()
    page.onPickGroup.call(instance, { currentTarget: { dataset: { groupId: '' } } })
    expect(instance.moveFavorite).toHaveBeenCalledWith('player-1', null)
  })

  it('keeps the favorite and refreshes a filtered group after removal', async () => {
    const instance = context()
    await page.moveFavorite.call(instance, 'player-1', null)

    expect(mocks.move).toHaveBeenCalledWith('player-1', null)
    expect(instance.data.items).toEqual([{ playerId: 'player-1', groupId: null }])
    expect(instance.data.showGroupPicker).toBe(false)
    expect(instance.loadFavorites).toHaveBeenCalledWith('refresh')
    expect(wx.showToast).toHaveBeenCalledWith({ title: '已移出分组', icon: 'success' })
  })
})
