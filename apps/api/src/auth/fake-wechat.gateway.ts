import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { WechatGateway, WechatIdentity } from './wechat.gateway.js';

@Injectable()
export class FakeWechatGateway implements WechatGateway {
  constructor(private readonly devOpenId?: string) {}

  async exchangeCode(code: string): Promise<WechatIdentity> {
    const match = /^test-code-([A-Za-z0-9_-]+)$/.exec(code);
    if (match?.[1]) return { openId: `test-openid-${match[1]}` };
    if (!this.devOpenId) {
      throw new UnauthorizedException({
        code: 'WECHAT_CODE_INVALID',
        message: 'WeChat login code is invalid'
      });
    }

    return { openId: this.devOpenId };
  }
}
