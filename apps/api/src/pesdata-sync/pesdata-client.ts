import { randomBytes } from 'node:crypto';
import type { ZodType } from 'zod';
import {
  PesdataDetailEnvelopeSchema,
  PesdataListEnvelopeSchema,
  type PesdataPlayerDetail,
  type PesdataPlayerSummary
} from './pesdata.schemas.js';
import {
  canonicalizePesdataParams,
  signPesdataRequest,
  type PesdataRequestParam
} from './pesdata-signer.js';

export type PesdataEndpoint = 'list' | 'detail';
export type PesdataClientErrorCode =
  | 'PESDATA_CONFIG_MISSING'
  | 'PESDATA_PROTOCOL_ERROR'
  | 'PESDATA_REQUEST_FAILED';

export class PesdataClientError extends Error {
  constructor(
    readonly code: PesdataClientErrorCode,
    message: string,
    readonly endpoint?: PesdataEndpoint,
    readonly status?: number,
    readonly attempts = 0
  ) {
    super(message);
    this.name = 'PesdataClientError';
  }
}

export type PesdataClientConfig = {
  baseUrl: string;
  siteVersion: string;
  signatureSeed?: string;
  requestsPerSecond: number;
  timeoutMs: number;
  maxRetries: number;
  deviceId?: string;
};

export type PesdataClientDependencies = {
  fetchImplementation?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  nonce?: () => string;
  random?: () => number;
};

type ListQuery = {
  start: number;
  limit: number;
  order: 'ASC' | 'DESC';
};

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class PesdataClient {
  private readonly fetchImplementation: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private readonly nonce: () => string;
  private readonly random: () => number;
  private readonly signatureSeed: string | undefined;
  private readonly deviceId: string;
  private requestTail: Promise<void> = Promise.resolve();
  private lastRequestStartedAt?: number;

  constructor(
    private readonly config: PesdataClientConfig,
    dependencies: PesdataClientDependencies = {}
  ) {
    this.signatureSeed = config.signatureSeed;
    this.deviceId = config.deviceId ?? randomBytes(16).toString('hex');
    this.fetchImplementation = dependencies.fetchImplementation ?? fetch;
    this.sleep = dependencies.sleep ?? defaultSleep;
    this.now = dependencies.now ?? Date.now;
    this.nonce = dependencies.nonce ?? (() => Math.random().toString(36).slice(2, 15));
    this.random = dependencies.random ?? Math.random;
  }

  listPlayers(query: ListQuery): Promise<{ list: PesdataPlayerSummary[]; count: number }> {
    return this.enqueue(async () => {
      const envelope = await this.request('list', '/api/player/list', query, PesdataListEnvelopeSchema);
      return envelope.data;
    });
  }

  getPlayerDetail(playerId: string): Promise<PesdataPlayerDetail> {
    return this.enqueue(async () => {
      const envelope = await this.request(
        'detail',
        '/api/player/detail',
        { id: playerId },
        PesdataDetailEnvelopeSchema
      );
      if (envelope.data.length !== 1) {
        throw this.protocolError('detail', 1);
      }
      return envelope.data[0] as PesdataPlayerDetail;
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.requestTail.then(operation, operation);
    this.requestTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async request<T>(
    endpoint: PesdataEndpoint,
    path: string,
    params: Record<string, PesdataRequestParam>,
    schema: ZodType<T>
  ): Promise<T> {
    if (!this.signatureSeed) {
      throw new PesdataClientError(
        'PESDATA_CONFIG_MISSING',
        'PESDATA signing material is not configured',
        endpoint
      );
    }
    const maximumAttempts = this.config.maxRetries + 1;

    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      await this.throttle();
      const timestamp = Math.floor(this.now() / 1_000);
      const nonce = this.nonce();
      const signature = signPesdataRequest(params, timestamp, nonce, this.signatureSeed);
      const url = new URL(path, this.config.baseUrl);
      url.search = canonicalizePesdataParams(params);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        const response = await this.fetchImplementation(url, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            version: this.config.siteVersion,
            'X-Device-ID': this.deviceId,
            'X-Timestamp': String(timestamp),
            'X-Nonce': nonce,
            'X-Signature': signature
          }
        });

        if (response.status === 429 || response.status >= 500) {
          if (attempt === maximumAttempts) {
            throw this.requestFailed(endpoint, response.status, attempt);
          }
          await this.backoff(attempt);
          continue;
        }

        if (!response.ok) {
          throw this.protocolError(endpoint, attempt, response.status);
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw this.protocolError(endpoint, attempt, response.status);
        }

        const parsed = schema.safeParse(payload);
        if (!parsed.success) {
          throw this.protocolError(endpoint, attempt, response.status);
        }
        return parsed.data;
      } catch (error) {
        if (error instanceof PesdataClientError) throw error;
        if (attempt === maximumAttempts) {
          throw this.requestFailed(endpoint, undefined, attempt);
        }
        await this.backoff(attempt);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw this.requestFailed(endpoint, undefined, maximumAttempts);
  }

  private async throttle(): Promise<void> {
    const minimumInterval = 1_000 / this.config.requestsPerSecond;
    const now = this.now();
    if (this.lastRequestStartedAt !== undefined) {
      const remaining = minimumInterval - (now - this.lastRequestStartedAt);
      if (remaining > 0) await this.sleep(remaining);
    }
    this.lastRequestStartedAt = this.now();
  }

  private async backoff(attempt: number): Promise<void> {
    const base = Math.min(1_000 * 2 ** (attempt - 1), 8_000);
    await this.sleep(base + Math.floor(base * 0.2 * this.random()));
  }

  private protocolError(endpoint: PesdataEndpoint, attempts: number, status?: number) {
    return new PesdataClientError(
      'PESDATA_PROTOCOL_ERROR',
      'PESDATA returned an unsupported response',
      endpoint,
      status,
      attempts
    );
  }

  private requestFailed(endpoint: PesdataEndpoint, status: number | undefined, attempts: number) {
    return new PesdataClientError(
      'PESDATA_REQUEST_FAILED',
      'PESDATA request failed after retrying',
      endpoint,
      status,
      attempts
    );
  }
}
