import type { AuthTokenResponse } from '@efm/contracts'
import { apiRuntimeConfig, type ApiRuntimeConfig } from '../config/api'
import { session } from './session'

type ApiErrorEnvelope = {
  error?: {
    code?: string
    message?: string
    requestId?: string
  }
}

export type ApiRequestOptions = {
  path: string
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  data?: string | WechatMiniprogram.IAnyObject | ArrayBuffer
  skipAuth?: boolean
  headers?: Record<string, string>
}

type RawResponse<T> = {
  statusCode: number
  data: T
}

type CloudContainerApi = {
  callContainer<T>(options: {
    config: { env: string }
    path: string
    method: ApiRequestOptions['method']
    data?: ApiRequestOptions['data']
    header: Record<string, string>
  }): Promise<RawResponse<T>>
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
    readonly requestId?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

let refreshPromise: Promise<void> | undefined

export function rawRequestWithConfig<T>(
  runtimeConfig: ApiRuntimeConfig,
  options: ApiRequestOptions,
  accessToken?: string,
): Promise<RawResponse<T>> {
  const tunnelsPatch = runtimeConfig.transport === 'http' && options.method === 'PATCH'
  const header = {
    'content-type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...options.headers,
    ...(tunnelsPatch ? { 'X-HTTP-Method-Override': 'PATCH' } : {}),
  }

  if (runtimeConfig.transport === 'http') {
    const method = options.method === 'PATCH' ? 'POST' : options.method ?? 'GET'
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${runtimeConfig.baseUrl}${options.path}`,
        method,
        data: options.data,
        header,
        success: (response) => resolve({
          statusCode: response.statusCode,
          data: response.data as T,
        }),
        fail: () => reject(new ApiError('NETWORK_ERROR', '网络连接失败，请确认本地 API 已启动', 0)),
      })
    })
  }

  const cloud = wx.cloud as unknown as CloudContainerApi
  return cloud.callContainer<T>({
    config: { env: runtimeConfig.environmentId },
    path: `${runtimeConfig.basePath}${options.path}`,
    method: options.method ?? 'GET',
    data: options.data,
    header: {
      'X-WX-SERVICE': runtimeConfig.serviceName,
      ...header,
    },
  }).catch(() => {
    throw new ApiError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
  })
}

function rawRequest<T>(options: ApiRequestOptions, accessToken?: string): Promise<RawResponse<T>> {
  return rawRequestWithConfig<T>(apiRuntimeConfig, options, accessToken)
}

function toApiError(response: RawResponse<unknown>): ApiError {
  const envelope = response.data as ApiErrorEnvelope
  return new ApiError(
    envelope.error?.code ?? 'REQUEST_FAILED',
    envelope.error?.message ?? '请求未完成，请稍后重试',
    response.statusCode,
    envelope.error?.requestId,
  )
}

async function refreshSession(): Promise<void> {
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    const refreshToken = session.getRefreshToken()
    if (!refreshToken) throw new ApiError('AUTH_REQUIRED', '请重新登录', 401)
    const response = await rawRequest<AuthTokenResponse>({
      path: '/auth/refresh',
      method: 'POST',
      data: { refreshToken },
      skipAuth: true,
    })
    if (response.statusCode < 200 || response.statusCode >= 300) throw toApiError(response)
    session.setTokens(response.data)
  })().catch((error: unknown) => {
    session.clear()
    wx.reLaunch({ url: '/pages/login/index' })
    throw error
  }).finally(() => {
    refreshPromise = undefined
  })
  return refreshPromise
}

async function request<T>(options: ApiRequestOptions, retried = false): Promise<T> {
  const response = await rawRequest<T>(
    options,
    options.skipAuth ? undefined : session.getAccessToken(),
  )
  if (response.statusCode >= 200 && response.statusCode < 300) return response.data

  const error = toApiError(response)
  if (!options.skipAuth && !retried && error.code === 'AUTH_TOKEN_EXPIRED') {
    await refreshSession()
    return request<T>(options, true)
  }
  throw error
}

export const api = { request }
