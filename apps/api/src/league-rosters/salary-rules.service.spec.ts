import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { SalaryRulesService, defaultSalaryTiers } from './salary-rules.service.js';

config({ path: '../../.env', quiet: true });

describe('SalaryRulesService', () => {
  const prisma = new PrismaService();
  const service = new SalaryRulesService(
    prisma,
    new AdminAuthorizationService(prisma),
    new AuditLogService(prisma)
  );
  const ids = { admins: [] as string[], users: [] as string[], leagues: [] as string[] };

  beforeAll(() => prisma.$connect());

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { leagueId: { in: ids.leagues } } });
    await prisma.leaguePlayerOwnership.deleteMany({ where: { leagueId: { in: ids.leagues } } });
    await prisma.leagueSalaryRuleVersion.deleteMany({ where: { leagueId: { in: ids.leagues } } });
    await prisma.leagueTeam.deleteMany({ where: { leagueId: { in: ids.leagues } } });
    await prisma.league.deleteMany({ where: { id: { in: ids.leagues } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.adminAccount.deleteMany({ where: { id: { in: ids.admins } } });
    ids.admins.length = 0;
    ids.users.length = 0;
    ids.leagues.length = 0;
  });

  afterAll(() => prisma.$disconnect());

  async function fixture() {
    const admin = await prisma.adminAccount.create({
      data: {
        username: `salary-${randomUUID()}`,
        displayName: 'Salary Admin',
        passwordHash: 'test',
        platformRole: 'PLATFORM_ADMIN'
      }
    });
    const user = await prisma.user.create({
      data: { wechatOpenId: `salary-${randomUUID()}`, displayName: 'League owner' }
    });
    const league = await prisma.league.create({
      data: {
        name: `League ${randomUUID()}`,
        shortName: 'SAL',
        defaultPlatform: 'MOBILE',
        defaultServerRegion: 'CN',
        createdById: user.id
      }
    });
    ids.admins.push(admin.id);
    ids.users.push(user.id);
    ids.leagues.push(league.id);
    return { admin, user, league };
  }

  const createRule = (adminId: string, leagueId: string, salaryCapMinor: number, salary93 = 200) =>
    service.createVersion(adminId, leagueId, {
      salaryCapMinor,
      tiers: defaultSalaryTiers().map((tier) =>
        tier.minDtRating === 93 ? { ...tier, salaryMinor: salary93 } : tier),
      effectiveAt: new Date(Date.now() - 1_000).toISOString(),
      expectedCurrentVersion: 0
    });

  it('rejects salary tiers with a DT gap or overlap', async () => {
    const { admin, league } = await fixture();
    await expect(service.createVersion(admin.id, league.id, {
      salaryCapMinor: 10_000,
      tiers: [
        { minDtRating: 0, maxDtRating: 92, salaryMinor: 100 },
        { minDtRating: 94, maxDtRating: 120, salaryMinor: 200 }
      ],
      effectiveAt: new Date().toISOString(),
      expectedCurrentVersion: 0
    })).rejects.toThrow();
  });

  it('quotes league-specific overrides and never mutates an older version', async () => {
    const first = await fixture();
    const second = await fixture();
    const firstRule = await createRule(first.admin.id, first.league.id, 10_000, 250);
    await createRule(second.admin.id, second.league.id, 20_000, 450);

    await expect(service.quote(first.league.id, 93)).resolves.toMatchObject({ salaryMinor: 250 });
    await expect(service.quote(second.league.id, 93)).resolves.toMatchObject({ salaryMinor: 450 });

    await service.createVersion(first.admin.id, first.league.id, {
      salaryCapMinor: 12_000,
      tiers: defaultSalaryTiers(),
      effectiveAt: new Date().toISOString(),
      expectedCurrentVersion: 1
    });
    await expect(prisma.leagueSalaryRuleVersion.findUnique({ where: { id: firstRule.id } }))
      .resolves.toMatchObject({ version: 1, salaryCapMinor: 10_000 });
  });

  it('previews recalculated team salary and cap violations without changing ownership', async () => {
    const { admin, user, league } = await fixture();
    const current = await createRule(admin.id, league.id, 1_000, 200);
    const shell = await prisma.teamCatalogItem.create({
      data: { sourceType: 'CUSTOM', nameZh: 'One', shortName: 'ONE' }
    });
    const team = await prisma.leagueTeam.create({
      data: { leagueId: league.id, ownerUserId: user.id, ownerAlias: user.displayName, catalogTeamId: shell.id, teamNumber: 1, name: 'One', shortName: 'ONE' }
    });
    const source = await prisma.dataSource.create({
      data: { code: `salary-source-${randomUUID()}`, name: 'Salary source' }
    });
    const player = await prisma.footballPlayer.create({ data: { nameEn: 'Preview Player' } });
    const card = await prisma.playerCard.create({
      data: {
        sourceId: source.id,
        externalId: `salary-card-${randomUUID()}`,
        playerId: player.id,
        cardName: 'Preview',
        position: 'CB',
        overallRating: 93,
        cardType: 'STANDARD'
      }
    });
    await prisma.leaguePlayerOwnership.create({
      data: {
        leagueId: league.id,
        leagueTeamId: team.id,
        footballPlayerId: player.id,
        currentPlayerCardId: card.id,
        dtRatingSnapshot: 93,
        salaryRuleVersionId: current.id,
        salaryMinor: 200
      }
    });

    const preview = await service.previewRecalculation(league.id, {
      salaryCapMinor: 300,
      tiers: defaultSalaryTiers().map((tier) =>
        tier.minDtRating === 93 ? { ...tier, salaryMinor: 400 } : tier)
    });

    expect(preview.teams).toEqual([expect.objectContaining({
      leagueTeamId: team.id,
      currentSalaryMinor: 200,
      projectedSalaryMinor: 400,
      projectedStatus: 'OVER_CAP'
    })]);
    await expect(prisma.leaguePlayerOwnership.findFirstOrThrow({ where: { leagueTeamId: team.id } }))
      .resolves.toMatchObject({ salaryMinor: 200, salaryRuleVersionId: current.id });

    await prisma.leaguePlayerOwnership.deleteMany({ where: { leagueId: league.id } });
    await prisma.playerCard.delete({ where: { id: card.id } });
    await prisma.footballPlayer.delete({ where: { id: player.id } });
    await prisma.dataSource.delete({ where: { id: source.id } });
  });

  it('marks a team over cap when an immediately-effective cap is lowered', async () => {
    const { admin, user, league } = await fixture();
    const current = await createRule(admin.id, league.id, 1_000, 200);
    const shell = await prisma.teamCatalogItem.create({
      data: { sourceType: 'CUSTOM', nameZh: 'Cap team', shortName: 'CAP' }
    });
    const team = await prisma.leagueTeam.create({
      data: { leagueId: league.id, ownerUserId: user.id, ownerAlias: user.displayName, catalogTeamId: shell.id, teamNumber: 1, name: 'Cap team', shortName: 'CAP' }
    });
    const source = await prisma.dataSource.create({
      data: { code: `cap-source-${randomUUID()}`, name: 'Cap source' }
    });
    const player = await prisma.footballPlayer.create({ data: { nameEn: 'Cap Player' } });
    const card = await prisma.playerCard.create({
      data: {
        sourceId: source.id,
        externalId: `cap-card-${randomUUID()}`,
        playerId: player.id,
        cardName: 'Cap card',
        position: 'CB',
        overallRating: 93,
        cardType: 'STANDARD'
      }
    });
    await prisma.leaguePlayerOwnership.create({
      data: {
        leagueId: league.id,
        leagueTeamId: team.id,
        footballPlayerId: player.id,
        currentPlayerCardId: card.id,
        dtRatingSnapshot: 93,
        salaryRuleVersionId: current.id,
        salaryMinor: 200
      }
    });

    await service.createVersion(admin.id, league.id, {
      salaryCapMinor: 150,
      tiers: defaultSalaryTiers(),
      effectiveAt: new Date(Date.now() - 1_000).toISOString(),
      expectedCurrentVersion: 1
    });

    await expect(service.createVersion(admin.id, league.id, {
      salaryCapMinor: 10_000,
      tiers: defaultSalaryTiers(),
      effectiveAt: current.effectiveAt.toISOString(),
      expectedCurrentVersion: 2
    })).rejects.toMatchObject({ code: 'SALARY_RULE_EFFECTIVE_AT_NOT_INCREASING' });

    await expect(prisma.leagueTeam.findUniqueOrThrow({
      where: { id: team.id }, select: { rosterStatus: true }
    })).resolves.toEqual({ rosterStatus: 'OVER_CAP' });
    await expect(prisma.leaguePlayerOwnership.findFirstOrThrow({
      where: { leagueTeamId: team.id }, select: { salaryMinor: true, salaryRuleVersionId: true }
    })).resolves.toEqual({ salaryMinor: 200, salaryRuleVersionId: current.id });

    await prisma.leaguePlayerOwnership.deleteMany({ where: { leagueId: league.id } });
    await prisma.playerCard.delete({ where: { id: card.id } });
    await prisma.footballPlayer.delete({ where: { id: player.id } });
    await prisma.dataSource.delete({ where: { id: source.id } });
  });
});
