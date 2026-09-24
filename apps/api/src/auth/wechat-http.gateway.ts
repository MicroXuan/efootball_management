import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { WechatGateway, WechatIdentity } from './wechat.gateway.js';

type FetchImplementation = typeof fetch;

type WechatResponse = {
  openid?: string;
  unionid?: string;
  errcode?: number;
};

@Injectable()
export class WechatHttpGateway implements WechatGateway {
  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly fetchImplementation: FetchImplementation = fetch,
    private readonly timeoutMs = 5_000
  ) {}

  async exchangeCode(code: string): Promise<WechatIdentity> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
      url.search = new URLSearchParams({
        appid: this.appId,
        secret: this.appSecret,
        js_code: code,
        grant_type: 'authorization_code'
      }).toString();
      const response = await this.fetchImplementation(url, { signal: controller.signal });
      if (!response.ok) throw this.unavailable();

      const result = await response.json() as WechatResponse;
      if (result.errcode !== undefined || !result.openid) {
        if (result.errcode === 40029 || result.errcode === 40163) {
          throw new UnauthorizedException({
            code: 'WECHAT_CODE_INVALID',
            message: 'WeChat login code is invalid'
          });
        }
        throw this.unavailable();
      }

      return {
        openId: result.openid,
        ...(result.unionid ? { unionId: result.unionid } : {})
      };
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw this.unavailable();
    } finally {
      clearTimeout(timeout);
    }
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'WECHAT_SERVICE_UNAVAILABLE',
      message: 'WeChat login service is unavailable'
    });
  }
}
