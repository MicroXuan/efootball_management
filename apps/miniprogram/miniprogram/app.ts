import { cloudEnvironmentId } from './config/cloud'

App<IAppOption>({
  globalData: {},
  onLaunch() {
    if (!wx.cloud) {
      console.error('当前微信基础库不支持云开发能力')
      return
    }

    wx.cloud.init({
      env: cloudEnvironmentId,
      traceUser: true,
    })

  },
})
