type MiniProgramEnvVersion = 'develop' | 'trial' | 'release'

export type ApiRuntimeConfig =
  | {
    transport: 'http'
    baseUrl: string
  }
  | {
    transport: 'cloudbase'
    environmentId: string
    serviceName: string
    basePath: string
  }

const stagingCloudbaseApi = {
  environmentId: 'cloud1-d0g1gwk2aefd9f1e8',
  serviceName: 'efm-dev',
}

const productionCloudbaseApi = {
  environmentId: 'efm-production-d1gmvq6jvbc778e79',
  serviceName: 'efm-api-production',
}

export function resolveCloudbaseApiConfig(envVersion: MiniProgramEnvVersion) {
  return envVersion === 'release' ? productionCloudbaseApi : stagingCloudbaseApi
}

export function resolveApiRuntimeConfig(
  envVersion: MiniProgramEnvVersion,
  platform: string,
): ApiRuntimeConfig {
  if (envVersion === 'develop' && platform === 'devtools') {
    return {
      transport: 'http',
      baseUrl: 'http://127.0.0.1:3000/v1',
    }
  }

  const cloudbaseApi = resolveCloudbaseApiConfig(envVersion)
  return {
    transport: 'cloudbase',
    ...cloudbaseApi,
    basePath: '/v1',
  }
}

const runtimeEnvVersion: MiniProgramEnvVersion = typeof wx === 'undefined'
  || typeof wx.getAccountInfoSync !== 'function'
  ? 'develop'
  : wx.getAccountInfoSync().miniProgram.envVersion
const runtimePlatform = typeof wx === 'undefined'
  || typeof wx.getSystemInfoSync !== 'function'
  ? 'unknown'
  : wx.getSystemInfoSync().platform
const cloudbaseApi = resolveCloudbaseApiConfig(runtimeEnvVersion)

export const apiRuntimeConfig = resolveApiRuntimeConfig(runtimeEnvVersion, runtimePlatform)

export const cloudbaseEnvironmentId = cloudbaseApi.environmentId
export const cloudbaseServiceName = cloudbaseApi.serviceName
export const apiBasePath = '/v1'

export const localWechatLoginCode = undefined
