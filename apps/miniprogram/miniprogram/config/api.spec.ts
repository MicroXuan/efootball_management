import { describe, expect, it } from 'vitest'

import {
  apiBasePath,
  cloudbaseEnvironmentId,
  cloudbaseServiceName,
  localWechatLoginCode,
  resolveCloudbaseApiConfig,
} from './api'

describe('mini-program API configuration', () => {
  it('targets the deployed staging CloudBase service and uses real WeChat login', () => {
    expect(cloudbaseEnvironmentId).toBe('cloud1-d0g1gwk2aefd9f1e8')
    expect(cloudbaseServiceName).toBe('efm-api-staging')
    expect(apiBasePath).toBe('/v1')
    expect(localWechatLoginCode).toBeUndefined()
  })

  it.each([
    ['develop', 'cloud1-d0g1gwk2aefd9f1e8', 'efm-api-staging'],
    ['trial', 'cloud1-d0g1gwk2aefd9f1e8', 'efm-api-staging'],
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
})
