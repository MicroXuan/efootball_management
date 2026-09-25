import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaService } from './prisma.service.js';

config({ path: '../../.env', quiet: true });

describe('PrismaService', () => {
  const prisma = new PrismaService();

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('persists and removes a user through the MySQL schema', async () => {
    const openId = `test-openid-${randomUUID()}`;
    const created = await prisma.user.create({
      data: {
        wechatOpenId: openId,
        displayName: '数据库测试玩家'
      }
    });

    expect(created.wechatOpenId).toBe(openId);
    await prisma.user.delete({ where: { id: created.id } });
    await expect(prisma.user.findUnique({ where: { id: created.id } })).resolves.toBeNull();
  });

  it('exposes player catalog and import delegates', () => {
    expect(prisma.dataSource).toBeDefined();
    expect(prisma.playerCard).toBeDefined();
    expect(prisma.importBatch).toBeDefined();
    expect(prisma.catalogRelease).toBeDefined();
  });

  it('exposes external synchronization delegates', () => {
    expect(prisma.externalSyncRun).toBeDefined();
    expect(prisma.externalSyncItem).toBeDefined();
    expect(prisma.externalSyncRunBatch).toBeDefined();
  });
});
