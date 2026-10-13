import { describe, expect, it, vi } from 'vitest'
import { completeProfileLogin } from './profile-login'

function harness() {
  const page = {
    data: { loginLoading: false },
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch) },
    loadPage: vi.fn(async () => undefined)
  }
  return page
}

describe('profile one-tap login', () => {
  it('authenticates and reloads profile data in the same page', async () => {
    const page = harness()
    const authenticate = vi.fn(async () => undefined)

    await completeProfileLogin(page, authenticate)

    expect(authenticate).toHaveBeenCalledOnce()
    expect(page.loadPage).toHaveBeenCalledOnce()
    expect(page.data.loginLoading).toBe(false)
  })

  it('coalesces two rapid taps into one authentication request', async () => {
    const page = harness()
    let finish!: () => void
    const authenticate = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))

    const first = completeProfileLogin(page, authenticate)
    const second = completeProfileLogin(page, authenticate)
    finish()
    await Promise.all([first, second])

    expect(authenticate).toHaveBeenCalledOnce()
    expect(page.loadPage).toHaveBeenCalledOnce()
  })

  it('shows the login error and restores the button after authentication fails', async () => {
    const page = harness()
    const authenticate = vi.fn(async () => { throw new Error('微信登录暂时不可用') })

    await completeProfileLogin(page, authenticate)

    expect(page.data).toMatchObject({ loginLoading: false, state: 'loaded', loggedIn: false, errorMessage: '微信登录暂时不可用' })
    expect(page.loadPage).not.toHaveBeenCalled()
  })
})
