import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { compare } from 'bcryptjs';
import { PrismaService } from '../database/prisma.service.js';

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const RECEIPT_RETENTION_MS = 24 * 60 * 60 * 1_000;

export type BridgePrincipal = { deviceId: string };

export type BridgeRequest = {
  method: string;
  originalUrl: string;
  headers: Record<string, string | string[] | undefined>;
  bridgePrincipal?: BridgePrincipal;
};

function header(request: BridgeRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function unauthorized(): UnauthorizedException {
  return new UnauthorizedException({ code: 'BRIDGE_UNAUTHORIZED', message: 'Bridge authentication failed' });
}

@Injectable()
export class WechatBridgeAuthGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<BridgeRequest>();
    const authorization = header(request, 'authorization');
    const deviceId = header(request, 'x-bridge-device');
    const timestamp = header(request, 'x-bridge-timestamp');
    const nonce = header(request, 'x-bridge-nonce');
    const signature = header(request, 'x-bridge-signature');
    const token = authorization?.startsWith('Bridge ') ? authorization.slice('Bridge '.length) : undefined;

    if (!token || !deviceId || !timestamp || !nonce || !signature) throw unauthorized();

    const requestTime = Date.parse(timestamp);
    if (!Number.isFinite(requestTime) || Math.abs(Date.now() - requestTime) > MAX_CLOCK_SKEW_MS) {
      throw unauthorized();
    }

    const device = await this.prisma.wechatBotDevice.findUnique({
      where: { id: deviceId },
      select: { id: true, tokenHash: true, status: true }
    });
    if (!device || device.status !== 'ACTIVE' || !(await compare(token, device.tokenHash))) throw unauthorized();

    const path = request.originalUrl.split('?', 1)[0] ?? request.originalUrl;
    const canonical = `${request.method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}`;
    const expected = createHmac('sha256', token).update(canonical).digest('hex');
    if (!/^[0-9a-f]{64}$/i.test(signature)) throw unauthorized();

    const expectedBytes = Buffer.from(expected, 'hex');
    const signatureBytes = Buffer.from(signature, 'hex');
    if (signatureBytes.length !== expectedBytes.length || !timingSafeEqual(signatureBytes, expectedBytes)) {
      throw unauthorized();
    }

    try {
      await this.prisma.wechatBridgeRequestReceipt.create({ data: { deviceId, nonce } });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        throw new ConflictException({
          code: 'BRIDGE_REQUEST_REPLAYED',
          message: 'Bridge request nonce has already been used'
        });
      }
      throw error;
    }

    await this.prisma.wechatBridgeRequestReceipt.deleteMany({
      where: { receivedAt: { lt: new Date(Date.now() - RECEIPT_RETENTION_MS) } }
    });
    request.bridgePrincipal = { deviceId: device.id };
    return true;
  }
}
