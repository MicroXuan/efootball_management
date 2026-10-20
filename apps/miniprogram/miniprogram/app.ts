import { apiRuntimeConfig } from './config/api'

App<IAppOption>({
  globalData: {},
  onLaunch() {
    if (apiRuntimeConfig.transport === 'cloudbase') {
      wx.cloud.init({ env: apiRuntimeConfig.environmentId })
    }
  },
})

export {}
