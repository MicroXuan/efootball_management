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

  it('exposes competition aggregate and idempotency delegates', () => {
    expect(prisma.competition).toBeDefined();
    expect(prisma.competitionRuleVersion).toBeDefined();
    expect(prisma.competitionRegistration).toBeDefined();
    expect(prisma.competitionRegistrationStatusHistory).toBeDefined();
    expect(prisma.competitionParticipant).toBeDefined();
    expect(prisma.competitionStage).toBeDefined();
    expect(prisma.competitionMatch).toBeDefined();
    expect(prisma.matchResultVersion).toBeDefined();
    expect(prisma.standingsSnapshot).toBeDefined();
    expect(prisma.standingsRow).toBeDefined();
    expect(prisma.mutationReceipt).toBeDefined();
  });

  it('exposes administrator, league-team, audit, and public-number delegates', () => {
    expect(prisma.adminAccount).toBeDefined();
    expect(prisma.adminSession).toBeDefined();
    expect(prisma.adminLeagueRole).toBeDefined();
    expect(prisma.leagueTeam).toBeDefined();
    expect(prisma.auditLog).toBeDefined();
    expect(prisma.publicUserNumberSequence).toBeDefined();
  });

  it('enforces league-scoped team ownership and numbering while preserving public user numbers', async () => {
    const suffix = randomUUID();
    const owner = await prisma.user.create({
      data: {
        wechatOpenId: `team-owner-${suffix}`,
        publicUserNo: '800001',
        displayName: '联赛球队测试玩家'
      }
    });
    const secondOwner = await prisma.user.create({
      data: {
        wechatOpenId: `team-owner-two-${suffix}`,
        publicUserNo: '800002',
        displayName: '第二位测试玩家'
      }
    });
    const firstLeague = await prisma.league.create({
      data: {
        name: `第一测试联赛-${suffix}`,
        shortName: '第一联赛',
        defaultPlatform: 'MOBILE',
        defaultServerRegion: 'GLOBAL',
        createdById: owner.id
      }
    });
    const secondLeague = await prisma.league.create({
      data: {
        name: `第二测试联赛-${suffix}`,
        shortName: '第二联赛',
        defaultPlatform: 'MOBILE',
        defaultServerRegion: 'GLOBAL',
        createdById: owner.id
      }
    });

    try {
      await prisma.leagueTeam.create({
        data: {
          leagueId: firstLeague.id,
          ownerUserId: owner.id,
          teamNumber: 0,
          name: '第一联赛球队',
          shortName: '一队'
        }
      });

      await expect(prisma.leagueTeam.create({
        data: {
          leagueId: firstLeague.id,
          ownerUserId: owner.id,
          teamNumber: 1,
          name: '重复用户球队',
          shortName: '重复用户'
        }
      })).rejects.toMatchObject({ code: 'P2002' });

      await expect(prisma.leagueTeam.create({
        data: {
          leagueId: firstLeague.id,
          ownerUserId: secondOwner.id,
          teamNumber: 0,
          name: '重复编号球队',
          shortName: '重复编号'
        }
      })).rejects.toMatchObject({ code: 'P2002' });

      await expect(prisma.leagueTeam.create({
        data: {
          leagueId: secondLeague.id,
          ownerUserId: owner.id,
          teamNumber: 0,
          name: '第二联赛球队',
          shortName: '二队'
        }
      })).resolves.toMatchObject({ ownerUserId: owner.id, teamNumber: 0 });

      await expect(prisma.user.findUniqueOrThrow({ where: { id: owner.id } }))
        .resolves.toMatchObject({ publicUserNo: '800001' });
      await expect(prisma.user.create({
        data: {
          wechatOpenId: `duplicate-public-number-${suffix}`,
          publicUserNo: '800001',
          displayName: '重复编号玩家'
        }
      })).rejects.toMatchObject({ code: 'P2002' });
    } finally {
      await prisma.leagueTeam.deleteMany({
        where: { leagueId: { in: [firstLeague.id, secondLeague.id] } }
      });
      await prisma.league.deleteMany({
        where: { id: { in: [firstLeague.id, secondLeague.id] } }
      });
      await prisma.user.deleteMany({ where: { id: { in: [owner.id, secondOwner.id] } } });
    }
  });
});
