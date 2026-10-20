import { describe, expect, it } from 'vitest'

import {
  apiBasePath,
  cloudbaseEnvironmentId,
  cloudbaseServiceName,
  localWechatLoginCode,
  resolveApiRuntimeConfig,
  resolveCloudbaseApiConfig,
} from './api'

describe('mini-program API configuration', () => {
  it('targets the deployed staging CloudBase service and uses real WeChat login', () => {
    expect(cloudbaseEnvironmentId).toBe('cloud1-d0g1gwk2aefd9f1e8')
    expect(cloudbaseServiceName).toBe('efm-dev')
    expect(apiBasePath).toBe('/v1')
    expect(localWechatLoginCode).toBeUndefined()
  })

  it.each([
    ['develop', 'cloud1-d0g1gwk2aefd9f1e8', 'efm-dev'],
    ['trial', 'cloud1-d0g1gwk2aefd9f1e8', 'efm-dev'],
    ['release', 'efm-production-d1gmvq6jvbc778e79', 'efm-api-production'],
  ] as const)('routes the %s mini-program version to the correct CloudBase service', (
    envVersion,
    environmentId,
    serviceName,
  ) => {
    expect(resolveCloudbaseApiConfig(envVersion)).toEqual({
      environmentId,
      serviceName,
    })
  })

  it('uses the local API only inside WeChat DevTools', () => {
    expect(resolveApiRuntimeConfig('develop', 'devtools')).toEqual({
      transport: 'http',
      baseUrl: 'http://127.0.0.1:3000/v1',
    })
  })

  it.each([
    ['develop', 'ios', 'cloud1-d0g1gwk2aefd9f1e8', 'efm-dev'],
    ['trial', 'devtools', 'cloud1-d0g1gwk2aefd9f1e8', 'efm-dev'],
    ['release', 'devtools', 'efm-production-d1gmvq6jvbc778e79', 'efm-api-production'],
  ] as const)('keeps %s on %s connected through CloudBase', (
    envVersion,
    platform,
    environmentId,
    serviceName,
  ) => {
    expect(resolveApiRuntimeConfig(envVersion, platform)).toEqual({
      transport: 'cloudbase',
      environmentId,
      serviceName,
      basePath: '/v1',
    })
  })
})
