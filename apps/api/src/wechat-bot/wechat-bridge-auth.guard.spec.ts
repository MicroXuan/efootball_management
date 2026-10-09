/* eslint-disable @typescript-eslint/no-explicit-any -- focused Prisma test double */
import { createHmac, randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { WechatBridgeAuthGuard } from './wechat-bridge-auth.guard.js';

type TestRequest = {
  method: string;
  originalUrl: string;
  headers: Record<string, string | undefined>;
  bridgePrincipal?: { deviceId: string };
};

function contextFor(request: TestRequest) {
  return {
    switchToHttp: () => ({ getRequest: () => request })
  } as never;
}

function signedHeaders(token: string, deviceId: string, path: string, timestamp: string, nonce: string = randomUUID()) {
  const canonical = `POST\n${path}\n${timestamp}\n${nonce}`;
  return {
    authorization: `Bridge ${token}`,
    'x-bridge-device': deviceId,
    'x-bridge-timestamp': timestamp,
    'x-bridge-nonce': nonce,
    'x-bridge-signature': createHmac('sha256', token).update(canonical).digest('hex')
  };
}

describe('WechatBridgeAuthGuard', () => {
  const deviceId = '11111111-1111-4111-8111-111111111111';
  const token = 'bridge-token-with-more-than-thirty-two-characters';
  const path = '/v1/wechat-bot/bridge/heartbeat';
  let tokenHash: string;
  let prisma: any;
  let guard: WechatBridgeAuthGuard;

  beforeAll(async () => {
    tokenHash = await hash(token, 4);
  });

  beforeEach(() => {
    const seenNonces = new Set<string>();
    prisma = {
      wechatBotDevice: {
        findUnique: jest.fn(async ({ where }: any) => where.id === deviceId ? {
          id: deviceId,
          tokenHash,
          status: 'ACTIVE'
        } : null)
      },
      wechatBridgeRequestReceipt: {
        create: jest.fn(async ({ data }: any) => {
          if (seenNonces.has(data.nonce)) throw { code: 'P2002' };
          seenNonces.add(data.nonce);
          return data;
        }),
        deleteMany: jest.fn(async () => ({ count: 0 }))
      }
    };
    guard = new WechatBridgeAuthGuard(prisma);
  });

  it('rejects missing bridge headers', async () => {
    await expect(guard.canActivate(contextFor({ method: 'POST', originalUrl: path, headers: {} })))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an unknown or disabled device', async () => {
    const timestamp = new Date().toISOString();
    const unknown = signedHeaders(token, randomUUID(), path, timestamp);
    await expect(guard.canActivate(contextFor({ method: 'POST', originalUrl: path, headers: unknown })))
      .rejects.toBeInstanceOf(UnauthorizedException);

    prisma.wechatBotDevice.findUnique.mockResolvedValue({ id: deviceId, tokenHash, status: 'DISABLED' });
    const disabled = signedHeaders(token, deviceId, path, timestamp);
    await expect(guard.canActivate(contextFor({ method: 'POST', originalUrl: path, headers: disabled })))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a bad token or signature', async () => {
    const timestamp = new Date().toISOString();
    const badToken = signedHeaders('wrong-token-with-more-than-thirty-two-characters', deviceId, path, timestamp);
    await expect(guard.canActivate(contextFor({ method: 'POST', originalUrl: path, headers: badToken })))
      .rejects.toBeInstanceOf(UnauthorizedException);

    const badSignature = { ...signedHeaders(token, deviceId, path, timestamp), 'x-bridge-signature': '0'.repeat(64) };
    await expect(guard.canActivate(contextFor({ method: 'POST', originalUrl: path, headers: badSignature })))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects timestamps outside five minutes', async () => {
    const timestamp = new Date(Date.now() - 300_001).toISOString();
    const headers = signedHeaders(token, deviceId, path, timestamp);
    await expect(guard.canActivate(contextFor({ method: 'POST', originalUrl: path, headers })))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a validly signed repeated nonce with BRIDGE_REQUEST_REPLAYED', async () => {
    const timestamp = new Date().toISOString();
    const headers = signedHeaders(token, deviceId, path, timestamp, 'nonce-once');
    await expect(guard.canActivate(contextFor({ method: 'POST', originalUrl: path, headers }))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor({ method: 'POST', originalUrl: path, headers }))).rejects.toMatchObject({
      constructor: ConflictException,
      response: { code: 'BRIDGE_REQUEST_REPLAYED' }
    });
  });

  it('accepts the exact method, path, timestamp, and nonce signature and attaches the principal', async () => {
    const timestamp = new Date().toISOString();
    const request: TestRequest = {
      method: 'POST',
      originalUrl: path,
      headers: signedHeaders(token, deviceId, path, timestamp)
    };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.bridgePrincipal).toEqual({ deviceId });
    expect(prisma.wechatBridgeRequestReceipt.deleteMany).toHaveBeenCalledWith({
      where: { receivedAt: { lt: expect.any(Date) } }
    });
  });
});
