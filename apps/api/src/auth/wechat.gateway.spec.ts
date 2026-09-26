import { FakeWechatGateway } from './fake-wechat.gateway.js';
import { WechatHttpGateway } from './wechat-http.gateway.js';

function errorCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('getResponse' in error)) return undefined;
  const response = (error as { getResponse(): unknown }).getResponse();
  return typeof response === 'object' && response !== null && 'code' in response
    ? response.code
    : undefined;
}

async function expectRejectCode(action: Promise<unknown>, code: string): Promise<void> {
  try {
    await action;
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(errorCode(error)).toBe(code);
  }
}

describe('WeChat gateways', () => {
  it('maps deterministic fake codes without accepting arbitrary input', async () => {
    const gateway = new FakeWechatGateway('test-openid-competition-demo-1');

    await expect(gateway.exchangeCode('test-code-alice')).resolves.toEqual({
      openId: 'test-openid-alice'
    });
    await expect(gateway.exchangeCode('simulator-one-time-code')).resolves.toEqual({
      openId: 'test-openid-competition-demo-1'
    });
    await expectRejectCode(new FakeWechatGateway().exchangeCode('production-code'), 'WECHAT_CODE_INVALID');
  });

  it('exchanges a code with the official endpoint without exposing credentials', async () => {
    const fetchMock = async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe('https://api.weixin.qq.com/sns/jscode2session');
      expect(url.searchParams.get('appid')).toBe('app-id');
      expect(url.searchParams.get('secret')).toBe('app-secret');
      expect(url.searchParams.get('js_code')).toBe('valid-code');
      return new Response(JSON.stringify({ openid: 'openid-1', unionid: 'unionid-1' }));
    };
    const gateway = new WechatHttpGateway('app-id', 'app-secret', fetchMock);

    await expect(gateway.exchangeCode('valid-code')).resolves.toEqual({
      openId: 'openid-1',
      unionId: 'unionid-1'
    });
  });

  it('maps rejected codes and unavailable service responses', async () => {
    const invalidGateway = new WechatHttpGateway(
      'app-id',
      'app-secret',
      async () => new Response(JSON.stringify({ errcode: 40029, errmsg: 'invalid code' }))
    );
    const unavailableGateway = new WechatHttpGateway(
      'app-id',
      'app-secret',
      async () => { throw new TypeError('network unavailable'); }
    );

    await expectRejectCode(invalidGateway.exchangeCode('bad-code'), 'WECHAT_CODE_INVALID');
    await expectRejectCode(
      unavailableGateway.exchangeCode('valid-code'),
      'WECHAT_SERVICE_UNAVAILABLE'
    );
  });

  it('aborts an exchange after the configured timeout', async () => {
    const gateway = new WechatHttpGateway(
      'app-id',
      'app-secret',
      (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
      5
    );

    await expectRejectCode(gateway.exchangeCode('slow-code'), 'WECHAT_SERVICE_UNAVAILABLE');
  });
});
