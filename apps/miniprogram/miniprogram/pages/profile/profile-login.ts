export type ProfileLoginPage = {
  data: { loginLoading: boolean }
  setData(patch: {
    loginLoading?: boolean
    state?: 'loading' | 'loaded' | 'error'
    loggedIn?: boolean
    errorMessage?: string
  }): void
  loadPage(showLoading?: boolean): Promise<void>
}

export async function completeProfileLogin(
  page: ProfileLoginPage,
  authenticate: () => Promise<void>,
  message = (error: unknown) => error instanceof Error ? error.message : '微信登录失败，请稍后重试'
) {
  if (page.data.loginLoading) return
  page.setData({ loginLoading: true, errorMessage: '' })
  try {
    await authenticate()
    await page.loadPage(false)
  } catch (error) {
    page.setData({ state: 'loaded', loggedIn: false, errorMessage: message(error) })
  } finally {
    page.setData({ loginLoading: false })
  }
}
