import {
  AdminAuthResponseSchema,
  AdminMeResponseSchema,
  type AdminAuthResponse,
  type AdminLoginRequest,
  type AdminMeResponse
} from '@efm/contracts';
import { z } from 'zod';

const REFRESH_TOKEN_KEY = 'efm.admin.refresh';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type RequestOptions<T> = Omit<RequestInit, 'body'> & {
  schema: z.ZodType<T>;
  body?: unknown;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;

  constructor(input: {
    status: number;
    code: string;
    requestId?: string;
    serverMessage?: string;
  }) {
    super(`后台请求失败（${input.code}）`);
    this.name = 'ApiError';
    this.status = input.status;
    this.code = input.code;
    this.requestId = input.requestId;
  }
}

export interface AdminApi {
  restore(): Promise<AdminMeResponse | null>;
  login(input: AdminLoginRequest): Promise<AdminMeResponse>;
  logout(): Promise<void>;
  onSessionExpired(listener: () => void): () => void;
  request<T>(path: string, options: RequestOptions<T>): Promise<T>;
  upload?<T>(path: string, file: File, schema: z.ZodType<T>): Promise<T>;
}

export class AdminApiClient implements AdminApi {
  private readonly fetcher: Fetcher;
  private readonly baseUrl: string;
  private accessToken: string | null = null;
  private refreshInFlight: Promise<AdminAuthResponse> | null = null;
  private sessionGeneration = 0;
  private readonly sessionExpiredListeners = new Set<() => void>();

  constructor(options: { fetcher?: Fetcher; baseUrl?: string } = {}) {
    this.fetcher = options.fetcher ?? fetch.bind(globalThis);
    this.baseUrl = options.baseUrl?.replace(/\/$/, '') ?? '';
  }

  accept(auth: AdminAuthResponse): void {
    this.sessionGeneration += 1;
    this.storeAuth(AdminAuthResponseSchema.parse(auth));
  }

  async login(input: AdminLoginRequest): Promise<AdminMeResponse> {
    const generation = ++this.sessionGeneration;
    this.clearTokens();
    const response = await this.send('/v1/admin/auth/login', {
      method: 'POST',
      body: input,
      schema: AdminAuthResponseSchema
    }, false);
    this.assertCurrentGeneration(generation);
    this.storeAuth(response);
    try {
      const identity = await this.me();
      this.assertCurrentGeneration(generation);
      return identity;
    } catch (error) {
      if (generation === this.sessionGeneration) this.invalidateSession(false);
      throw error;
    }
  }

  async restore(): Promise<AdminMeResponse | null> {
    if (!this.readRefreshToken()) return null;
    const generation = this.sessionGeneration;
    try {
      await this.refresh();
      return await this.me();
    } catch {
      if (generation === this.sessionGeneration) this.invalidateSession(false);
      return null;
    }
  }

  async logout(): Promise<void> {
    const refreshToken = this.readRefreshToken();
    this.invalidateSession(false);
    if (refreshToken) {
      await this.send('/v1/admin/auth/logout', {
        method: 'POST',
        body: { refreshToken },
        schema: z.object({ ok: z.literal(true) })
      }, false);
    }
  }

  onSessionExpired(listener: () => void): () => void {
    this.sessionExpiredListeners.add(listener);
    return () => this.sessionExpiredListeners.delete(listener);
  }

  request<T>(path: string, options: RequestOptions<T>): Promise<T> {
    return this.send(path, options, true);
  }

  upload<T>(path: string, file: File, schema: z.ZodType<T>): Promise<T> {
    const formData = new FormData();
    formData.append('file', file);
    return this.send(path, { method: 'POST', body: formData, schema }, true);
  }

  private me(): Promise<AdminMeResponse> {
    return this.send('/v1/admin/auth/me', { schema: AdminMeResponseSchema }, true);
  }

  private refresh(): Promise<AdminAuthResponse> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const generation = this.sessionGeneration;
    const refreshToken = this.readRefreshToken();
    if (!refreshToken) {
      return Promise.reject(new ApiError({ status: 401, code: 'ADMIN_SESSION_EXPIRED' }));
    }
    const refreshRequest = this.send('/v1/admin/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
      schema: AdminAuthResponseSchema
    }, false).then((response) => {
      this.assertCurrentGeneration(generation);
      this.storeAuth(response);
      return response;
    }).catch((error: unknown) => {
      if (generation === this.sessionGeneration && this.isSessionRejection(error)) {
        this.invalidateSession(true);
      }
      throw error;
    }).finally(() => {
      if (this.refreshInFlight === refreshRequest) this.refreshInFlight = null;
    });
    this.refreshInFlight = refreshRequest;
    return refreshRequest;
  }

  private async send<T>(
    path: string,
    options: RequestOptions<T>,
    retryAfterRefresh: boolean
  ): Promise<T> {
    const { schema, body, headers: optionHeaders, ...requestInit } = options;
    const isMultipart = typeof FormData !== 'undefined' && body instanceof FormData;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(body === undefined || isMultipart ? {} : { 'Content-Type': 'application/json' }),
      ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
      ...this.normalizeHeaders(optionHeaders)
    };
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...requestInit,
      headers,
      ...(body === undefined ? {} : { body: isMultipart ? body : JSON.stringify(body) })
    });
    if (response.status === 401 && retryAfterRefresh && this.readRefreshToken()) {
      await this.refresh();
      return this.send(path, options, false);
    }
    const payload = await this.readJson(response);
    if (!response.ok) throw this.error(response.status, payload);
    return schema.parse(payload);
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      if (response.ok) throw new ApiError({ status: 502, code: 'ADMIN_API_INVALID_RESPONSE' });
      return undefined;
    }
  }

  private error(status: number, payload: unknown): ApiError {
    const body = payload as {
      error?: { code?: unknown; message?: unknown; requestId?: unknown };
    } | undefined;
    return new ApiError({
      status,
      code: typeof body?.error?.code === 'string' ? body.error.code : 'REQUEST_FAILED',
      ...(typeof body?.error?.requestId === 'string' ? { requestId: body.error.requestId } : {}),
      ...(typeof body?.error?.message === 'string' ? { serverMessage: body.error.message } : {})
    });
  }

  private normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
    if (!headers) return {};
    return Object.fromEntries(new Headers(headers).entries());
  }

  private readRefreshToken(): string | null {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(REFRESH_TOKEN_KEY);
  }

  private writeRefreshToken(token: string): void {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(REFRESH_TOKEN_KEY, token);
  }

  private storeAuth(auth: AdminAuthResponse): void {
    const parsed = AdminAuthResponseSchema.parse(auth);
    this.accessToken = parsed.accessToken;
    this.writeRefreshToken(parsed.refreshToken);
  }

  private clearTokens(): void {
    this.accessToken = null;
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  }

  private invalidateSession(notify: boolean): void {
    this.sessionGeneration += 1;
    this.clearTokens();
    if (notify) this.sessionExpiredListeners.forEach((listener) => listener());
  }

  private assertCurrentGeneration(generation: number): void {
    if (generation !== this.sessionGeneration) {
      throw new ApiError({ status: 401, code: 'ADMIN_SESSION_EXPIRED' });
    }
  }

  private isSessionRejection(error: unknown): boolean {
    return error instanceof ApiError && (error.status === 401 || error.status === 403);
  }
}

export const adminApi = new AdminApiClient();
