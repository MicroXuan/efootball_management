import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, rawRequestWithConfig } from './api'

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
        'X-WX-SERVICE': 'efm-dev',
        'content-type': 'application/json',
      },
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('uses wx.request for the local DevTools API', async () => {
    request.mockImplementation(({ success }: WechatMiniprogram.RequestOption) => {
      success?.({
        statusCode: 200,
        data: { status: 'local' },
        header: {},
        cookies: [],
        profile: {} as WechatMiniprogram.RequestProfile,
        errMsg: 'request:ok',
      })
      return {} as WechatMiniprogram.RequestTask
    })

    await expect(rawRequestWithConfig<{ status: string }>(
      { transport: 'http', baseUrl: 'http://127.0.0.1:3000/v1' },
      { path: '/health', skipAuth: true },
    )).resolves.toEqual({ statusCode: 200, data: { status: 'local' } })

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      url: 'http://127.0.0.1:3000/v1/health',
      method: 'GET',
      data: undefined,
      header: { 'content-type': 'application/json' },
    }))
    expect(callContainer).not.toHaveBeenCalled()
  })

  it('tunnels PATCH through a method override for wx.request', async () => {
    request.mockImplementation(({ success }: WechatMiniprogram.RequestOption) => {
      success?.({
        statusCode: 200,
        data: { status: 'updated' },
        header: {},
        cookies: [],
        profile: {} as WechatMiniprogram.RequestProfile,
        errMsg: 'request:ok',
      })
      return {} as WechatMiniprogram.RequestTask
    })

    await rawRequestWithConfig(
      { transport: 'http', baseUrl: 'http://127.0.0.1:3000/v1' },
      { path: '/profile', method: 'PATCH', data: { displayName: '本地用户' } },
      'access-token',
    )

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      header: {
        Authorization: 'Bearer access-token',
        'X-HTTP-Method-Override': 'PATCH',
        'content-type': 'application/json',
      },
    }))
  })
})
