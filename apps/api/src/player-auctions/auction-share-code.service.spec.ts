import { jest } from '@jest/globals';
import { AuctionShareCodeService } from './auction-share-code.service.js';

describe('AuctionShareCodeService', () => {
  it('requests a code for the exact auction room and returns a displayable image', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
    const fetcher = jest.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token', expires_in: 7200 }), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(png, { headers: { 'content-type': 'image/png' } }));
    const service = new AuctionShareCodeService({
      getOrThrow: (key: string) => key === 'WECHAT_APP_ID' ? 'app-id' : key === 'WECHAT_APP_SECRET' ? 'app-secret' : 'trial'
    } as never, fetcher);
    const result = await service.create('22222222-2222-4222-8222-222222222222');
    expect(result).toEqual({ imageDataUrl: `data:image/png;base64,${png.toString('base64')}`, envVersion: 'trial' });
    expect(fetcher.mock.calls[1]?.[0]).toContain('/wxa/getwxacode?access_token=token');
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
      path: 'pages/auction-room/index?batchId=22222222-2222-4222-8222-222222222222',
      width: 430,
      env_version: 'trial'
    });
  });

  it('rejects a WeChat JSON error instead of treating it as an image', async () => {
    const fetcher = jest.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token', expires_in: 7200 }), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errcode: 41030, errmsg: 'invalid page' }), { headers: { 'content-type': 'application/json' } }));
    const service = new AuctionShareCodeService({ getOrThrow: (key: string) => key === 'WECHAT_APP_ID' ? 'app-id' : key === 'WECHAT_APP_SECRET' ? 'app-secret' : 'release' } as never, fetcher);
    await expect(service.create('22222222-2222-4222-8222-222222222222')).rejects.toMatchObject({ code: 'AUCTION_SHARE_CODE_UNAVAILABLE' });
  });

  it('accepts a JPEG code image when WeChat returns JPEG bytes', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 0xff, 0xd9]);
    const fetcher = jest.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token', expires_in: 7200 }), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } }));
    const service = new AuctionShareCodeService({ getOrThrow: (key: string) => key === 'WECHAT_MINIPROGRAM_ENV_VERSION' ? 'develop' : 'id-or-secret' } as never, fetcher);
    await expect(service.create('22222222-2222-4222-8222-222222222222')).resolves.toEqual({ imageDataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`, envVersion: 'develop' });
  });
});
