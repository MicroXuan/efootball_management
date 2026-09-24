import { ApiError } from '../../services/api'
import { auth } from '../../services/auth'

Page({
  data: {
    loading: false,
    errorMessage: '',
  },

  async login() {
    if (this.data.loading) return
    this.setData({ loading: true, errorMessage: '' })
    try {
      await auth.login()
      wx.reLaunch({ url: '/pages/profile/index' })
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
