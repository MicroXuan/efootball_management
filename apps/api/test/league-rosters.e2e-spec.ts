import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  RosterMutationResponseSchema,
  SalaryRecalculationResponseSchema
} from '@efm/contracts';
import { config } from 'dotenv';
import request from 'supertest';
import { PasswordService } from '../src/admin-auth/password.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { defaultSalaryTiers } from '../src/league-rosters/salary-rules.service.js';
import { createTestApp } from './test-app.js';

config({ path: '../../.env', quiet: true });

describe('atomic league roster API', () => {
  const prisma = new PrismaService();
  const suffix = randomUUID();
  const leagueIds: string[] = [];
  const userIds: string[] = [];
  const sourceIds: string[] = [];
  const catalogIds: string[] = [];
  let app: INestApplication;
  let adminId: string;
  let adminToken: string;
  let unscopedAdminId: string;
  let unscopedAdminToken: string;

  beforeAll(async () => {
    await prisma.$connect();
    app = await createTestApp();
    const passwords = app.get(PasswordService);
    const admin = await prisma.adminAccount.create({
      data: {
        username: `roster-e2e-${suffix}`,
        displayName: 'Roster E2E',
        passwordHash: await passwords.hash('roster-password-123'),
        platformRole: 'PLATFORM_ADMIN'
      }
    });
    adminId = admin.id;
    const login = await request(app.getHttpServer()).post('/v1/admin/auth/login')
      .send({ username: admin.username, password: 'roster-password-123' }).expect(200);
    adminToken = login.body.accessToken as string;
    const unscoped = await prisma.adminAccount.create({
      data: {
        username: `roster-unscoped-${suffix}`,
        displayName: 'Unscoped Roster Manager',
        passwordHash: await passwords.hash('roster-password-123'),
        platformRole: 'LEAGUE_MANAGER'
      }
    });
    unscopedAdminId = unscoped.id;
    const unscopedLogin = await request(app.getHttpServer()).post('/v1/admin/auth/login')
      .send({ username: unscoped.username, password: 'roster-password-123' }).expect(200);
    unscopedAdminToken = unscopedLogin.body.accessToken as string;
  });

  afterAll(async () => {
    await prisma.adminMutationReceipt.deleteMany({ where: { adminId } });
    await prisma.auditLog.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await prisma.financeLedgerEntry.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await prisma.rosterTransaction.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await prisma.leaguePlayerOwnership.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await prisma.transferWindow.deleteMany({ where: { season: { leagueId: { in: leagueIds } } } });
    await prisma.leagueSalaryRuleVersion.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await prisma.leagueTeam.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await prisma.teamCatalogItem.deleteMany({ where: { id: { in: catalogIds } } });
    await prisma.leagueSeason.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await prisma.league.deleteMany({ where: { id: { in: leagueIds } } });
    const cards = await prisma.playerCard.findMany({
      where: { sourceId: { in: sourceIds } },
      select: { id: true, playerId: true }
    });
    await prisma.footballPlayerBestCard.deleteMany({
      where: { footballPlayerId: { in: cards.map(({ playerId }) => playerId) } }
    });
    await prisma.playerCardAutoBuild.deleteMany({
      where: { playerCardId: { in: cards.map(({ id }) => id) } }
    });
    await prisma.playerCard.deleteMany({ where: { id: { in: cards.map(({ id }) => id) } } });
    await prisma.footballPlayer.deleteMany({
      where: { id: { in: cards.map(({ playerId }) => playerId) } }
    });
    await prisma.dataSource.deleteMany({ where: { id: { in: sourceIds } } });
    await prisma.adminSession.deleteMany({ where: { adminId: { in: [adminId, unscopedAdminId] } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.adminAccount.deleteMany({ where: { id: { in: [adminId, unscopedAdminId] } } });
    await app.close();
    await prisma.$disconnect();
  });

  async function fixture(label: string) {
    const now = Date.now();
    const users = await Promise.all([1, 2].map((index) => prisma.user.create({
      data: { wechatOpenId: `roster-e2e-${label}-${index}-${suffix}`, displayName: `${label} ${index}` }
    })));
    userIds.push(...users.map(({ id }) => id));
    const league = await prisma.league.create({
      data: {
        name: `Roster E2E ${label} ${suffix}`,
        shortName: label,
        defaultPlatform: 'MOBILE',
        defaultServerRegion: 'CN',
        createdByAdminId: adminId
      }
    });
    leagueIds.push(league.id);
    const season = await prisma.leagueSeason.create({
      data: {
        leagueId: league.id,
        seasonNumber: 1,
        displayName: 'S1',
        isFirstSeason: true,
        registrationOpensAt: new Date('2026-09-01T00:00:00.000Z'),
        registrationClosesAt: new Date('2026-09-05T00:00:00.000Z'),
        startsAt: new Date('2026-09-10T00:00:00.000Z'),
        endsAt: new Date('2026-10-10T00:00:00.000Z'),
        superCapacity: 23,
        championCapacity: 18,
        promotionCount: 4,
        createdById: users[0]!.id
      }
    });
    const teams = await Promise.all(users.map(async (user, index) => {
      const name = `${label} Team ${index + 1}`;
      const shortName = `${label}${index + 1}`;
      const shell = await prisma.teamCatalogItem.create({ data: { sourceType: 'CUSTOM', nameZh: name, shortName } });
      catalogIds.push(shell.id);
      return prisma.leagueTeam.create({ data: {
        leagueId: league.id,
        ownerUserId: user.id,
        ownerAlias: user.displayName,
        catalogTeamId: shell.id,
        teamNumber: index + 1,
        name,
        shortName
      } });
    }));
    await prisma.leagueSalaryRuleVersion.create({
      data: {
        leagueId: league.id,
        version: 1,
        salaryCapMinor: 200,
        effectiveAt: new Date('2026-09-01T00:00:00.000Z'),
        createdByAdminId: adminId,
        tiers: { create: defaultSalaryTiers() }
      }
    });
    await prisma.transferWindow.create({
      data: {
        seasonId: season.id,
        name: 'Main',
        startsAt: new Date(now - 24 * 60 * 60 * 1_000),
        endsAt: new Date(now + 24 * 60 * 60 * 1_000),
        allowBuy: true,
        allowSell: true,
        allowTransfer: true,
        allowCardUpgrade: true,
        createdByAdminId: adminId
      }
    });
    const source = await prisma.dataSource.create({
      data: { code: `roster-e2e-${label}-${suffix}`, name: `Roster E2E ${label}` }
    });
    sourceIds.push(source.id);
    return { league, season, teams, source };
  }

  async function createCard(sourceId: string, name: string, footballPlayerId?: string) {
    const player = footballPlayerId
      ? await prisma.footballPlayer.findUniqueOrThrow({ where: { id: footballPlayerId } })
      : await prisma.footballPlayer.create({ data: { nameEn: name } });
    const card = await prisma.playerCard.create({
      data: {
        sourceId,
        externalId: `${name}-${randomUUID()}`,
        playerId: player.id,
        cardName: name,
        position: 'CB',
        overallRating: 93,
        cardType: 'STANDARD',
        autoBuilds: {
          create: {
            algorithmVersion: 'e2e-v1',
            allocationJson: { defending: 10 },
            maxOverall: 93,
            dtRating: 93
          }
        }
      }
    });
    return { player, card };
  }

  const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
  const acquisition = (
    seasonId: string,
    teamId: string,
    playerCardId: string,
    idempotencyKey = randomUUID()
  ) => ({
    seasonId,
    targetLeagueTeamId: teamId,
    playerCardId,
    amountMinor: 1_000,
    idempotencyKey,
    reason: 'Concurrent auction'
  });

  it('allows exactly one team to acquire variants of the same real player', async () => {
    const f = await fixture('same-player');
    const first = await createCard(f.source.id, 'Bonucci One');
    const second = await createCard(f.source.id, 'Bonucci Two', first.player.id);

    await request(app.getHttpServer()).post('/v1/admin/roster/acquisitions')
      .set(auth(unscopedAdminToken))
      .send(acquisition(f.season.id, f.teams[0]!.id, first.card.id))
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('ADMIN_LEAGUE_ACCESS_DENIED'));

    const responses = await Promise.all([
      request(app.getHttpServer()).post('/v1/admin/roster/acquisitions').set(auth())
        .send(acquisition(f.season.id, f.teams[0]!.id, first.card.id)),
      request(app.getHttpServer()).post('/v1/admin/roster/acquisitions').set(auth())
        .send(acquisition(f.season.id, f.teams[1]!.id, second.card.id))
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(responses.find(({ status }) => status === 409)?.body.error.code)
      .toBe('LEAGUE_PLAYER_ALREADY_OWNED');
    await expect(prisma.leaguePlayerOwnership.count({
      where: { leagueId: f.league.id, status: 'ACTIVE' }
    })).resolves.toBe(1);

    const winner = responses.find(({ status }) => status === 201)!;
    await request(app.getHttpServer()).post('/v1/admin/roster/releases').set(auth())
      .send({
        seasonId: f.season.id,
        ownershipId: winner.body.ownership.id,
        amountMinor: 500,
        expectedVersion: winner.body.ownership.version,
        idempotencyKey: randomUUID(),
        reason: 'E2E sale'
      })
      .expect(201)
      .expect(({ body }) => expect(body.summary.rosterCount).toBe(0));
  });

  it('serializes same-team acquisitions at the salary-cap boundary', async () => {
    const f = await fixture('same-team-cap');
    const first = await createCard(f.source.id, 'Cap One');
    const second = await createCard(f.source.id, 'Cap Two');

    const responses = await Promise.all([
      request(app.getHttpServer()).post('/v1/admin/roster/acquisitions').set(auth())
        .send(acquisition(f.season.id, f.teams[0]!.id, first.card.id)),
      request(app.getHttpServer()).post('/v1/admin/roster/acquisitions').set(auth())
        .send(acquisition(f.season.id, f.teams[0]!.id, second.card.id))
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(responses.find(({ status }) => status === 409)?.body.error.code)
      .toBe('TEAM_SALARY_CAP_EXCEEDED');
    await expect(prisma.leaguePlayerOwnership.count({
      where: { leagueTeamId: f.teams[0]!.id, status: 'ACTIVE' }
    })).resolves.toBe(1);
  });

  it('serializes two acquisitions competing for roster slot 25', async () => {
    const f = await fixture('same-team-roster');
    await prisma.leagueSalaryRuleVersion.updateMany({
      where: { leagueId: f.league.id },
      data: { salaryCapMinor: 100_000 }
    });
    const rule = await prisma.leagueSalaryRuleVersion.findFirstOrThrow({
      where: { leagueId: f.league.id }
    });
    for (let index = 0; index < 24; index += 1) {
      const seeded = await createCard(f.source.id, `Seed ${index}`);
      await prisma.leaguePlayerOwnership.create({
        data: {
          leagueId: f.league.id,
          leagueTeamId: f.teams[0]!.id,
          footballPlayerId: seeded.player.id,
          currentPlayerCardId: seeded.card.id,
          maxOverallSnapshot: 93,
          dtRatingSnapshot: 93,
          salaryRuleVersionId: rule.id,
          salaryMinor: 200
        }
      });
    }
    const first = await createCard(f.source.id, 'Slot 25 A');
    const second = await createCard(f.source.id, 'Slot 25 B');

    const responses = await Promise.all([
      request(app.getHttpServer()).post('/v1/admin/roster/acquisitions').set(auth())
        .send(acquisition(f.season.id, f.teams[0]!.id, first.card.id)),
      request(app.getHttpServer()).post('/v1/admin/roster/acquisitions').set(auth())
        .send(acquisition(f.season.id, f.teams[0]!.id, second.card.id))
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(responses.find(({ status }) => status === 409)?.body.error.code)
      .toBe('TEAM_ROSTER_FULL');
    await expect(prisma.leaguePlayerOwnership.count({
      where: { leagueTeamId: f.teams[0]!.id, status: 'ACTIVE' }
    })).resolves.toBe(25);
  });

  it('rejects concurrent reuse of one idempotency key for different requests', async () => {
    const f = await fixture('idempotency-race');
    await prisma.leagueSalaryRuleVersion.updateMany({
      where: { leagueId: f.league.id },
      data: { salaryCapMinor: 10_000 }
    });
    const first = await createCard(f.source.id, 'Key race A');
    const second = await createCard(f.source.id, 'Key race B');
    const sharedKey = randomUUID();

    const responses = await Promise.all([
      request(app.getHttpServer()).post('/v1/admin/roster/acquisitions').set(auth())
        .send(acquisition(f.season.id, f.teams[0]!.id, first.card.id, sharedKey)),
      request(app.getHttpServer()).post('/v1/admin/roster/acquisitions').set(auth())
        .send(acquisition(f.season.id, f.teams[0]!.id, second.card.id, sharedKey))
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(responses.find(({ status }) => status === 409)?.body.error.code)
      .toBe('IDEMPOTENCY_KEY_REUSED');
    await expect(prisma.leaguePlayerOwnership.count({
      where: { leagueTeamId: f.teams[0]!.id, status: 'ACTIVE' }
    })).resolves.toBe(1);
  });

  it('executes transfer, explicit card upgrade, and confirmed salary recalculation APIs', async () => {
    const f = await fixture('advanced-roster');
    await prisma.leagueSalaryRuleVersion.updateMany({
      where: { leagueId: f.league.id },
      data: { salaryCapMinor: 1_000 }
    });
    const player = await createCard(f.source.id, 'Advanced base');
    const upgrade = await createCard(f.source.id, 'Advanced upgrade', player.player.id);
    await prisma.playerCardAutoBuild.updateMany({
      where: { playerCardId: upgrade.card.id },
      data: { maxOverall: 94, dtRating: null }
    });
    const acquired = await request(app.getHttpServer())
      .post('/v1/admin/roster/acquisitions').set(auth())
      .send(acquisition(f.season.id, f.teams[0]!.id, player.card.id))
      .expect(201);
    const transferred = await request(app.getHttpServer())
      .post('/v1/admin/roster/transfers').set(auth())
      .send({
        seasonId: f.season.id,
        ownershipId: acquired.body.ownership.id,
        targetLeagueTeamId: f.teams[1]!.id,
        amountMinor: 500,
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
        reason: 'E2E transfer'
      })
      .expect(201);
    expect(() => RosterMutationResponseSchema.parse(transferred.body)).not.toThrow();
    const upgraded = await request(app.getHttpServer())
      .post('/v1/admin/roster/card-upgrades').set(auth())
      .send({
        seasonId: f.season.id,
        ownershipId: acquired.body.ownership.id,
        newPlayerCardId: upgrade.card.id,
        amountMinor: 300,
        expectedVersion: transferred.body.ownership.version,
        idempotencyKey: randomUUID(),
        reason: 'E2E card upgrade'
      })
      .expect(201);
    expect(upgraded.body.ownership).toMatchObject({
      currentPlayerCardId: upgrade.card.id,
      maxOverall: 94,
      salaryMinor: 300
    });
    expect(() => RosterMutationResponseSchema.parse(upgraded.body)).not.toThrow();
    const rule = await prisma.leagueSalaryRuleVersion.create({
      data: {
        leagueId: f.league.id,
        version: 2,
        salaryCapMinor: 250,
        effectiveAt: new Date('2026-09-16T00:00:00.000Z'),
        createdByAdminId: adminId,
        tiers: { create: defaultSalaryTiers() }
      }
    });
    await request(app.getHttpServer())
      .post('/v1/admin/roster/salary-recalculations').set(auth())
      .send({
        leagueId: f.league.id,
        seasonId: f.season.id,
        salaryRuleVersionId: rule.id,
        confirm: true,
        idempotencyKey: randomUUID(),
        reason: 'E2E salary recalculation'
      })
      .expect(201)
      .expect(({ body }) => {
        expect(() => SalaryRecalculationResponseSchema.parse(body)).not.toThrow();
        expect(body).toMatchObject({ recalculatedPlayers: 1, overCapTeams: 1 });
      });
  });
});
