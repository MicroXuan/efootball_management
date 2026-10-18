type MiniProgramEnvVersion = 'develop' | 'trial' | 'release'

const stagingCloudbaseApi = {
  environmentId: 'cloud1-d0g1gwk2aefd9f1e8',
  serviceName: 'efm-api-staging',
}

const productionCloudbaseApi = {
  environmentId: 'efm-production-d1gmvq6jvbc778e79',
  serviceName: 'efm-api-production',
}

export function resolveCloudbaseApiConfig(envVersion: MiniProgramEnvVersion) {
  return envVersion === 'release' ? productionCloudbaseApi : stagingCloudbaseApi
}

const runtimeEnvVersion: MiniProgramEnvVersion = typeof wx === 'undefined'
  || typeof wx.getAccountInfoSync !== 'function'
  ? 'develop'
  : wx.getAccountInfoSync().miniProgram.envVersion
const cloudbaseApi = resolveCloudbaseApiConfig(runtimeEnvVersion)

export const cloudbaseEnvironmentId = cloudbaseApi.environmentId
export const cloudbaseServiceName = cloudbaseApi.serviceName
export const apiBasePath = '/v1'

export const localWechatLoginCode = undefined
