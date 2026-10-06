import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { TeamCatalogService } from './team-catalog.service.js';

config({ path: '../../.env', quiet: true });

describe('TeamCatalogService', () => {
  const prisma = new PrismaService();

  beforeAll(async () => prisma.$connect());
  afterAll(async () => prisma.$disconnect());

  it('filters published shells and reports league-specific occupancy', async () => {
    const suffix = randomUUID();
    const admin = await prisma.adminAccount.create({
      data: { username: `catalog-${suffix}`, displayName: '目录管理员', passwordHash: 'unused', platformRole: 'PLATFORM_ADMIN' }
    });
    const owner = await prisma.user.create({
      data: { wechatOpenId: `catalog-${suffix}`, displayName: '目录用户' }
    });
    const [firstLeague, secondLeague] = await Promise.all([
      prisma.league.create({ data: { name: `荷甲测试-${suffix}`, shortName: '荷甲', defaultPlatform: 'MOBILE', defaultServerRegion: 'GLOBAL', createdByAdminId: admin.id } }),
      prisma.league.create({ data: { name: `跨联赛测试-${suffix}`, shortName: '跨联赛', defaultPlatform: 'MOBILE', defaultServerRegion: 'GLOBAL', createdByAdminId: admin.id } })
    ]);
    const [ajax, disabled] = await Promise.all([
      prisma.teamCatalogItem.create({
        data: { sourceType: 'PESDATA', sourceExternalId: `ajax-${suffix}`, sourceLeagueName: '荷兰足球甲级联赛', nameZh: '阿贾克斯', nameEn: 'Ajax', shortName: '阿贾克斯', storedLogoUrl: 'https://media.example/ajax.webp' }
      }),
      prisma.teamCatalogItem.create({
        data: { sourceType: 'CUSTOM', nameZh: '停用球队', shortName: '停用', status: 'DISABLED' }
      })
    ]);
    const team = await prisma.leagueTeam.create({
      data: { leagueId: firstLeague.id, ownerUserId: owner.id, ownerAlias: 'tidus', catalogTeamId: ajax.id, teamNumber: 3, name: '阿贾克斯', shortName: '阿贾克斯', logoUrl: ajax.storedLogoUrl }
    });
    const service = new TeamCatalogService(prisma, new AuditLogService(prisma));

    try {
      await expect(service.listAvailable(firstLeague.id, { keyword: 'ajax' })).resolves.toMatchObject({
        items: [{ id: ajax.id, isAssigned: true, assignedLeagueTeamId: team.id }]
      });
      await expect(service.listAvailable(secondLeague.id, { sourceLeagueName: '荷兰足球甲级联赛' })).resolves.toMatchObject({
        items: [{ id: ajax.id, isAssigned: false, assignedLeagueTeamId: null }]
      });
      await expect(service.listAvailable(firstLeague.id, { keyword: '停用' })).resolves.toMatchObject({ items: [] });
      await expect(service.listAvailable(firstLeague.id, { keyword: '停用', includeDisabled: true })).resolves.toMatchObject({
        items: [{ id: disabled.id, status: 'DISABLED' }]
      });

      const custom = await service.createCustom(admin.id, {
        nameZh: '自定义球队',
        shortName: '自定义',
        storedLogoUrl: 'https://media.example/custom.webp'
      });
      expect(custom).toMatchObject({ sourceType: 'CUSTOM', nameZh: '自定义球队', storedLogoUrl: 'https://media.example/custom.webp' });
      await expect(prisma.auditLog.findFirst({ where: { resourceId: custom.id } })).resolves.toMatchObject({ action: 'CREATE_CUSTOM_TEAM_SHELL' });
      await prisma.teamCatalogItem.delete({ where: { id: custom.id } });
    } finally {
      await prisma.leagueTeam.delete({ where: { id: team.id } });
      await prisma.teamCatalogItem.deleteMany({ where: { id: { in: [ajax.id, disabled.id] } } });
      await prisma.league.deleteMany({ where: { id: { in: [firstLeague.id, secondLeague.id] } } });
      await prisma.user.delete({ where: { id: owner.id } });
      await prisma.auditLog.deleteMany({ where: { actorAdminId: admin.id } });
      await prisma.adminAccount.delete({ where: { id: admin.id } });
    }
  });
});
