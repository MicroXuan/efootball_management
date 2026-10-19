import { afterEach, describe, expect, it, vi } from 'vitest'

describe('mini-program startup boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('initializes the staging WeChat cloud environment once on launch', async () => {
    let appOptions: { onLaunch?: () => void } | undefined
    const cloudInit = vi.fn()
    vi.stubGlobal('App', (options: { onLaunch?: () => void }) => { appOptions = options })
    vi.stubGlobal('wx', { cloud: { init: cloudInit } })

    await import('../app')
    appOptions?.onLaunch?.()

    expect(cloudInit).toHaveBeenCalledOnce()
    expect(cloudInit).toHaveBeenCalledWith({ env: 'cloud1-d0g1gwk2aefd9f1e8' })
  })

  it('does not initialize CloudBase when DevTools uses the local API', async () => {
    let appOptions: { onLaunch?: () => void } | undefined
    const cloudInit = vi.fn()
    vi.stubGlobal('App', (options: { onLaunch?: () => void }) => { appOptions = options })
    vi.stubGlobal('wx', {
      cloud: { init: cloudInit },
      getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
      getSystemInfoSync: () => ({ platform: 'devtools' }),
    })

    await import('../app')
    appOptions?.onLaunch?.()

    expect(cloudInit).not.toHaveBeenCalled()
  })
})
