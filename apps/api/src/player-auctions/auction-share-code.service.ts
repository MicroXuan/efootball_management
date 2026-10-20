import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlayerAuctionError } from './player-auction.errors.js';

type MiniprogramEnvVersion = 'release' | 'trial' | 'develop';

@Injectable()
export class AuctionShareCodeService {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly fetcher: typeof fetch;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Optional() @Inject('AUCTION_SHARE_CODE_FETCHER') fetcher?: typeof fetch
  ) {
    this.fetcher = fetcher ?? fetch;
  }

  async create(batchId: string): Promise<{ imageDataUrl: string; envVersion: MiniprogramEnvVersion }> {
    try {
      const accessToken = await this.accessToken();
      const envVersion = this.config.getOrThrow<MiniprogramEnvVersion>('WECHAT_MINIPROGRAM_ENV_VERSION');
      const response = await this.fetcher(`https://api.weixin.qq.com/wxa/getwxacode?access_token=${encodeURIComponent(accessToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: `pages/auction-room/index?batchId=${batchId}`, width: 430, env_version: envVersion }),
        signal: AbortSignal.timeout(10_000)
      });
      const contentType = response.headers.get('content-type')?.split(';')[0];
      if (!response.ok || !['image/png', 'image/jpeg'].includes(contentType ?? '')) throw new Error('WECHAT_CODE_RESPONSE_INVALID');
      const bytes = Buffer.from(await response.arrayBuffer());
      const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      if (bytes.length > 2_000_000 || (contentType === 'image/png' ? !isPng : !isJpeg)) {
        throw new Error('WECHAT_CODE_IMAGE_INVALID');
      }
      return { imageDataUrl: `data:${contentType};base64,${bytes.toString('base64')}`, envVersion };
    } catch {
      throw new PlayerAuctionError('AUCTION_SHARE_CODE_UNAVAILABLE', '小程序码暂时无法生成，请稍后重试', 503);
    }
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
    url.search = new URLSearchParams({
      grant_type: 'client_credential',
      appid: this.config.getOrThrow<string>('WECHAT_APP_ID'),
      secret: this.config.getOrThrow<string>('WECHAT_APP_SECRET')
    }).toString();
    const response = await this.fetcher(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('WECHAT_TOKEN_HTTP_ERROR');
    const payload = await response.json() as { access_token?: string; expires_in?: number };
    if (!payload.access_token || !payload.expires_in) throw new Error('WECHAT_TOKEN_INVALID');
    this.token = { value: payload.access_token, expiresAt: Date.now() + Math.max(0, payload.expires_in - 300) * 1_000 };
    return payload.access_token;
  }
}
