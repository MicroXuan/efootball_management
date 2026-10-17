import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('player card image state', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('keeps a loaded image visible when refreshed card data uses the same URL', async () => {
    type Definition = { observers?: Record<string, unknown> }
    let definition: Definition | undefined
    vi.stubGlobal('Component', (options: typeof definition) => {
      definition = options
    })
    await import('./index')

    const state = {
      card: { imageUrl: 'https://img.example/player.webp' },
      imageUrl: 'https://img.example/player.webp',
      imageFailed: false,
      imageLoaded: true,
    }
    const context = {
      data: state,
      setData(patch: Partial<typeof state>) {
        Object.assign(state, patch)
      },
    }

    const observer = definition?.observers?.card as ((this: typeof context, card: typeof state.card) => void) | undefined
    observer?.call(context, state.card)

    expect(state.imageLoaded).toBe(true)
  })
})
