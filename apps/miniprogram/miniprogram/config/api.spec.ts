import { describe, expect, it } from 'vitest'

import { apiBaseUrl, localWechatLoginCode } from './api'

describe('mini-program API configuration', () => {
  it('targets the deployed staging API and uses real WeChat login', () => {
    expect(apiBaseUrl).toBe('https://efm-api-staging-330149-5-1495246258.sh.run.tcloudbase.com/v1')
    expect(localWechatLoginCode).toBeUndefined()
  })
})
