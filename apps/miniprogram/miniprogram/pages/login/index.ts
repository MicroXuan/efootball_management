import { ApiError } from '../../services/api'
import { auth } from '../../services/auth'

Page({
  data: {
    loading: false,
    errorMessage: '',
    redirect: '',
  },

  onLoad(options: { redirect?: string }) {
    const redirect = options.redirect ? decodeURIComponent(options.redirect) : ''
    this.setData({ redirect: redirect.startsWith('/pages/') ? redirect : '' })
  },

  async login() {
    if (this.data.loading) return
    this.setData({ loading: true, errorMessage: '' })
    try {
      await auth.login()
      if (this.data.redirect) wx.redirectTo({ url: this.data.redirect })
      else wx.switchTab({ url: '/pages/profile/index' })
    } catch (error) {
      const message = error instanceof ApiError
        ? error.message
        : '登录未完成，请检查网络后重试'
      this.setData({ errorMessage: message })
    } finally {
      this.setData({ loading: false })
    }
  },
})
