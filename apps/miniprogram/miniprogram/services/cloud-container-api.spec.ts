import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from './api'

describe('CloudBase container API transport', () => {
  const callContainer = vi.fn()
  const request = vi.fn()

  beforeEach(() => {
    callContainer.mockReset()
    request.mockReset()
    callContainer.mockResolvedValue({ statusCode: 200, data: { status: 'ok' } })
    ;(globalThis as typeof globalThis & { wx: WechatMiniprogram.Wx }).wx = {
      cloud: { callContainer },
      request,
    } as unknown as WechatMiniprogram.Wx
  })

  it('routes API requests through the linked CloudBase service', async () => {
    await expect(api.request<{ status: string }>({ path: '/health', skipAuth: true }))
      .resolves.toEqual({ status: 'ok' })

    expect(callContainer).toHaveBeenCalledWith({
      config: { env: 'cloud1-d0g1gwk2aefd9f1e8' },
      path: '/v1/health',
      method: 'GET',
      data: undefined,
      header: {
        'X-WX-SERVICE': 'efm-api-staging',
        'content-type': 'application/json',
      },
    })
    expect(request).not.toHaveBeenCalled()
  })
})
