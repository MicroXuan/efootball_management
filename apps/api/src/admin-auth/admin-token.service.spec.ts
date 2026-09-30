import { createHmac, randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../database/prisma.service.js';
import { AdminTokenService } from './admin-token.service.js';

config({ path: '../../.env', quiet: true });

const accessSecret = 'admin-test-access-secret-with-at-least-32-chars';
const refreshPepper = 'admin-test-refresh-pepper-with-at-least-32-chars';
const context = { ipAddress: '127.0.0.1', userAgent: 'admin-token-service-test' };

function decodePayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('JWT payload is missing');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

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

describe('AdminTokenService', () => {
  const prisma = new PrismaService();
  const service = new AdminTokenService(prisma, new JwtService(), { accessSecret, refreshPepper });
  let adminId: string;

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    const admin = await prisma.adminAccount.create({
      data: {
        username: `token-admin-${randomUUID()}`,
        displayName: '令牌测试管理员',
        passwordHash: 'not-used-by-token-tests',
        platformRole: 'PLATFORM_ADMIN'
      }
    });
    adminId = admin.id;
  });

  afterEach(async () => {
    await prisma.adminSession.deleteMany({ where: { adminId } });
    await prisma.adminAccount.deleteMany({ where: { id: adminId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('issues an ADMIN access token and stores only the refresh-token hash', async () => {
    const admin = await prisma.adminAccount.findUniqueOrThrow({ where: { id: adminId } });
    const pair = await service.issuePair(admin, context);
    const payload = decodePayload(pair.accessToken);
    const stored = await prisma.adminSession.findFirstOrThrow({ where: { adminId } });

    expect(payload.sub).toBe(adminId);
    expect(payload.actor).toBe('ADMIN');
    expect(Number(payload.exp) - Number(payload.iat)).toBe(15 * 60);
    expect(stored.tokenHash).not.toBe(pair.refreshToken);
    expect(stored.tokenHash).toBe(
      createHmac('sha256', refreshPepper).update(pair.refreshToken).digest('hex')
    );
  });

  it('rotates a refresh token and revokes the family when an old token is replayed', async () => {
    const admin = await prisma.adminAccount.findUniqueOrThrow({ where: { id: adminId } });
    const first = await service.issuePair(admin, context);
    const second = await service.rotate(first.refreshToken, context);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    await expectRejectCode(service.rotate(first.refreshToken, context), 'ADMIN_SESSION_REUSED');
    await expect(prisma.adminSession.count({ where: { adminId, revokedAt: null } })).resolves.toBe(0);
  });

  it('revokes a refresh token idempotently', async () => {
    const admin = await prisma.adminAccount.findUniqueOrThrow({ where: { id: adminId } });
    const pair = await service.issuePair(admin, context);

    await service.revoke(pair.refreshToken);
    await service.revoke(pair.refreshToken);

    await expect(prisma.adminSession.count({ where: { adminId, revokedAt: null } })).resolves.toBe(0);
  });
});
