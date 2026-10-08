import { afterEach, describe, expect, it, vi } from 'vitest'

describe('mini-program startup boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('starts without initializing an unused WeChat cloud environment', async () => {
    let appOptions: { onLaunch?: () => void } | undefined
    const cloudInit = vi.fn()
    vi.stubGlobal('App', (options: { onLaunch?: () => void }) => { appOptions = options })
    vi.stubGlobal('wx', { cloud: { init: cloudInit } })

    await import('../app')
    appOptions?.onLaunch?.()

    expect(cloudInit).not.toHaveBeenCalled()
  })
})
