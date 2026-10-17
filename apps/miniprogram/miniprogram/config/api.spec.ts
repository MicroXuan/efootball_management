import { describe, expect, it } from 'vitest'

import { apiBasePath, cloudbaseEnvironmentId, cloudbaseServiceName, localWechatLoginCode } from './api'

describe('mini-program API configuration', () => {
  it('targets the deployed staging CloudBase service and uses real WeChat login', () => {
    expect(cloudbaseEnvironmentId).toBe('cloud1-d0g1gwk2aefd9f1e8')
    expect(cloudbaseServiceName).toBe('efm-api-staging')
    expect(apiBasePath).toBe('/v1')
    expect(localWechatLoginCode).toBeUndefined()
  })
})
