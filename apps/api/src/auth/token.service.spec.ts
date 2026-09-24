import { createHmac, randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../database/prisma.service.js';
import { TokenService } from './token.service.js';

config({ path: '../../.env', quiet: true });

const accessSecret = 'test-access-secret-with-at-least-32-chars';
const refreshPepper = 'test-refresh-pepper-with-at-least-32-chars';
const context = { ipAddress: '127.0.0.1', userAgent: 'token-service-test' };

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

describe('TokenService', () => {
  const prisma = new PrismaService();
  const service = new TokenService(prisma, new JwtService(), { accessSecret, refreshPepper });
  let userId: string;

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        wechatOpenId: `token-test-${randomUUID()}`,
        displayName: '令牌测试玩家'
      }
    });
    userId = user.id;
  });

  afterEach(async () => {
    await prisma.refreshSession.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('issues a 15-minute access token and stores only the refresh-token hash', async () => {
    const pair = await service.issuePair({ id: userId, status: 'ACTIVE' }, context);
    const payload = decodePayload(pair.accessToken);
    const stored = await prisma.refreshSession.findFirstOrThrow({ where: { userId } });

    expect(payload.sub).toBe(userId);
    expect(payload.status).toBe('ACTIVE');
    expect(Number(payload.exp) - Number(payload.iat)).toBe(15 * 60);
    expect(pair.refreshToken).toHaveLength(64);
    expect(stored.tokenHash).not.toBe(pair.refreshToken);
    expect(stored.tokenHash).toBe(
      createHmac('sha256', refreshPepper).update(pair.refreshToken).digest('hex')
    );
  });

  it('rotates a refresh token into a replacement in the same family', async () => {
    const first = await service.issuePair({ id: userId, status: 'ACTIVE' }, context);
    const second = await service.rotate(first.refreshToken, context);
    const sessions = await prisma.refreshSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' }
    });

    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.revokedAt).toBeInstanceOf(Date);
    expect(sessions[0]?.replacedBySessionId).toBe(sessions[1]?.id);
    expect(sessions[1]?.familyId).toBe(sessions[0]?.familyId);
  });

  it('revokes the active token family when an old token is replayed', async () => {
    const first = await service.issuePair({ id: userId, status: 'ACTIVE' }, context);
    await service.rotate(first.refreshToken, context);

    await expectRejectCode(service.rotate(first.refreshToken, context), 'AUTH_SESSION_REUSED');
    const activeSessions = await prisma.refreshSession.count({
      where: { userId, revokedAt: null }
    });
    expect(activeSessions).toBe(0);
  });

  it('rejects expired refresh sessions', async () => {
    const pair = await service.issuePair({ id: userId, status: 'ACTIVE' }, context);
    await prisma.refreshSession.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1_000) }
    });

    await expectRejectCode(service.rotate(pair.refreshToken, context), 'AUTH_REFRESH_INVALID');
  });

  it('rejects sessions belonging to disabled users', async () => {
    const pair = await service.issuePair({ id: userId, status: 'ACTIVE' }, context);
    await prisma.user.update({ where: { id: userId }, data: { status: 'DISABLED' } });

    await expectRejectCode(service.rotate(pair.refreshToken, context), 'AUTH_USER_DISABLED');
  });
});
