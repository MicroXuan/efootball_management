import { cloudbaseEnvironmentId } from './config/api'

App<IAppOption>({
  globalData: {},
  onLaunch() {
    wx.cloud.init({ env: cloudbaseEnvironmentId })
  },
})

export {}
