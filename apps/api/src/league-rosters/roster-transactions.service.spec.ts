import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { PlayerBuildsService } from '../player-builds/player-builds.service.js';
import { RosterLockRepository } from './roster-lock.repository.js';
import { RosterTransactionsService } from './roster-transactions.service.js';
import { SalaryRulesService, defaultSalaryTiers } from './salary-rules.service.js';
import { TransferWindowsService } from './transfer-windows.service.js';

config({ path: '../../.env', quiet: true });

describe('RosterTransactionsService', () => {
  const prisma = new PrismaService();
  const authorization = new AdminAuthorizationService(prisma);
  const audit = new AuditLogService(prisma);
  const salaryRules = new SalaryRulesService(prisma, authorization, audit);
  const windows = new TransferWindowsService(prisma, authorization, audit);
  const service = new RosterTransactionsService(
    prisma,
    authorization,
    new AdminMutationReceiptService(prisma),
    audit,
    salaryRules,
    windows,
    new RosterLockRepository()
  );
  const createdLeagueIds: string[] = [];
  const createdAdminIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdSourceIds: string[] = [];

  beforeAll(() => prisma.$connect());

  afterEach(async () => {
    await prisma.adminMutationReceipt.deleteMany({ where: { adminId: { in: createdAdminIds } } });
    await prisma.auditLog.deleteMany({ where: { leagueId: { in: createdLeagueIds } } });
    await prisma.financeLedgerEntry.deleteMany({ where: { leagueId: { in: createdLeagueIds } } });
    await prisma.rosterTransaction.deleteMany({ where: { leagueId: { in: createdLeagueIds } } });
    await prisma.leaguePlayerOwnership.deleteMany({ where: { leagueId: { in: createdLeagueIds } } });
    await prisma.transferWindow.deleteMany({ where: { season: { leagueId: { in: createdLeagueIds } } } });
    await prisma.leagueSalaryRuleVersion.deleteMany({ where: { leagueId: { in: createdLeagueIds } } });
    await prisma.leagueTeam.deleteMany({ where: { leagueId: { in: createdLeagueIds } } });
    await prisma.leagueSeason.deleteMany({ where: { leagueId: { in: createdLeagueIds } } });
    await prisma.league.deleteMany({ where: { id: { in: createdLeagueIds } } });
    const cards = await prisma.playerCard.findMany({
      where: { sourceId: { in: createdSourceIds } },
      select: { id: true, playerId: true }
    });
    const cardIds = cards.map(({ id }) => id);
    const playerIds = cards.map(({ playerId }) => playerId);
    await prisma.footballPlayerBestCard.deleteMany({ where: { footballPlayerId: { in: playerIds } } });
    await prisma.playerCardAutoBuild.deleteMany({ where: { playerCardId: { in: cardIds } } });
    await prisma.playerCard.deleteMany({ where: { id: { in: cardIds } } });
    await prisma.footballPlayer.deleteMany({ where: { id: { in: playerIds } } });
    await prisma.dataSource.deleteMany({ where: { id: { in: createdSourceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.adminAccount.deleteMany({ where: { id: { in: createdAdminIds } } });
    createdLeagueIds.length = createdAdminIds.length = createdUserIds.length = createdSourceIds.length = 0;
  });

  afterAll(() => prisma.$disconnect());

  async function fixture(options: { cap?: number; openWindow?: boolean } = {}) {
    const admin = await prisma.adminAccount.create({
      data: {
        username: `roster-${randomUUID()}`,
        displayName: 'Roster Admin',
        passwordHash: 'test',
        platformRole: 'PLATFORM_ADMIN'
      }
    });
    const users = await Promise.all([1, 2].map((index) => prisma.user.create({
      data: { wechatOpenId: `roster-${randomUUID()}`, displayName: `Owner ${index}` }
    })));
    const league = await prisma.league.create({
      data: {
        name: `Roster ${randomUUID()}`,
        shortName: 'ROS',
        defaultPlatform: 'MOBILE',
        defaultServerRegion: 'CN',
        createdById: users[0]!.id
      }
    });
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
    const teams = await Promise.all(users.map((user, index) => prisma.leagueTeam.create({
      data: {
        leagueId: league.id,
        ownerUserId: user.id,
        teamNumber: index + 1,
        name: `Team ${index + 1}`,
        shortName: `T${index + 1}`
      }
    })));
    await salaryRules.createVersion(admin.id, league.id, {
      salaryCapMinor: options.cap ?? 10_000,
      tiers: defaultSalaryTiers(),
      effectiveAt: '2026-09-01T00:00:00.000Z',
      expectedCurrentVersion: 0
    });
    if (options.openWindow !== false) {
      await windows.create(admin.id, season.id, {
        name: 'Main',
        startsAt: '2026-09-10T00:00:00.000Z',
        endsAt: '2026-10-01T00:00:00.000Z',
        allowBuy: true,
        allowSell: true,
        allowTransfer: true,
        allowCardUpgrade: true
      });
    }
    const source = await prisma.dataSource.create({
      data: { code: `roster-source-${randomUUID()}`, name: 'Roster source' }
    });
    createdAdminIds.push(admin.id);
    createdUserIds.push(...users.map(({ id }) => id));
    createdLeagueIds.push(league.id);
    createdSourceIds.push(source.id);
    return { admin, users, league, season, teams, source };
  }

  async function card(sourceId: string, name: string, dtRating: number | null = 93) {
    const player = await prisma.footballPlayer.create({ data: { nameEn: name } });
    const playerCard = await prisma.playerCard.create({
      data: {
        sourceId,
        externalId: `${name}-${randomUUID()}`,
        playerId: player.id,
        cardName: name,
        position: 'CB',
        overallRating: 93,
        cardType: 'STANDARD'
      }
    });
    await new PlayerBuildsService(prisma).save(playerCard.id, {
      autoBuildAllocation: { defending: 10 },
      autoBuildMaxOverall: 93,
      dtRating,
      algorithmVersion: 'test-v1'
    });
    return { player, card: playerCard };
  }

  const acquisition = (
    seasonId: string,
    teamId: string,
    playerCardId: string,
    key: string = randomUUID()
  ) => ({
    seasonId,
    targetLeagueTeamId: teamId,
    playerCardId,
    amountMinor: 1_000,
    idempotencyKey: key,
    reason: 'Auction purchase'
  });

  it('acquires a player atomically and replays an identical idempotent result', async () => {
    const f = await fixture();
    const player = await card(f.source.id, 'Bonucci');
    const input = acquisition(f.season.id, f.teams[0]!.id, player.card.id, 'same-key');

    const first = await service.acquire(input, f.admin.id, new Date('2026-09-15T00:00:00.000Z'));
    const replay = await service.acquire(input, f.admin.id, new Date('2026-09-15T00:00:00.000Z'));

    expect(replay).toEqual(first);
    expect(first.summary).toMatchObject({ rosterCount: 1, salaryMinor: 200, salaryCapMinor: 10_000 });
    await expect(prisma.rosterTransaction.count({ where: { leagueId: f.league.id } })).resolves.toBe(1);
    await expect(prisma.financeLedgerEntry.count({ where: { leagueId: f.league.id } })).resolves.toBe(1);
  });

  it('rejects reuse of an idempotency key for a different request', async () => {
    const f = await fixture();
    const player = await card(f.source.id, 'Idempotency');
    const first = acquisition(f.season.id, f.teams[0]!.id, player.card.id, 'reused-key');
    await service.acquire(first, f.admin.id, new Date('2026-09-15T00:00:00.000Z'));

    await expect(service.acquire(
      { ...first, amountMinor: 2_000 },
      f.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    )).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    await expect(prisma.rosterTransaction.count({ where: { leagueId: f.league.id } })).resolves.toBe(1);
  });

  it('rejects another team buying a variant of an already-owned real player', async () => {
    const f = await fixture();
    const player = await card(f.source.id, 'Bonucci');
    const variant = await prisma.playerCard.create({
      data: {
        sourceId: f.source.id,
        externalId: `variant-${randomUUID()}`,
        playerId: player.player.id,
        cardName: 'Bonucci Variant',
        position: 'CB',
        overallRating: 94,
        cardType: 'EPIC'
      }
    });
    await new PlayerBuildsService(prisma).save(variant.id, {
      autoBuildAllocation: { defending: 11 },
      autoBuildMaxOverall: 94,
      dtRating: 94,
      algorithmVersion: 'test-v1'
    });
    await service.acquire(
      acquisition(f.season.id, f.teams[0]!.id, player.card.id),
      f.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    );

    await expect(service.acquire(
      acquisition(f.season.id, f.teams[1]!.id, variant.id),
      f.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    )).rejects.toMatchObject({ code: 'LEAGUE_PLAYER_ALREADY_OWNED' });
  });

  it('rejects missing DT, a closed window, and a salary above the cap', async () => {
    const missing = await fixture();
    const noDt = await card(missing.source.id, 'Missing DT', null);
    await expect(service.acquire(
      acquisition(missing.season.id, missing.teams[0]!.id, noDt.card.id),
      missing.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    )).rejects.toMatchObject({ code: 'PLAYER_DT_RATING_MISSING' });

    const closed = await fixture({ openWindow: false });
    const closedCard = await card(closed.source.id, 'Closed');
    await expect(service.acquire(
      acquisition(closed.season.id, closed.teams[0]!.id, closedCard.card.id),
      closed.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    )).rejects.toMatchObject({ code: 'TRANSFER_WINDOW_CLOSED' });

    const capped = await fixture({ cap: 199 });
    const cappedCard = await card(capped.source.id, 'Capped');
    await expect(service.acquire(
      acquisition(capped.season.id, capped.teams[0]!.id, cappedCard.card.id),
      capped.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    )).rejects.toMatchObject({ code: 'TEAM_SALARY_CAP_EXCEEDED' });
  });

  it('rejects a player card with no automatic build', async () => {
    const f = await fixture();
    const player = await prisma.footballPlayer.create({ data: { nameEn: 'No build' } });
    const playerCard = await prisma.playerCard.create({
      data: {
        sourceId: f.source.id,
        externalId: `no-build-${randomUUID()}`,
        playerId: player.id,
        cardName: 'No build',
        position: 'CB',
        overallRating: 93,
        cardType: 'STANDARD'
      }
    });

    await expect(service.acquire(
      acquisition(f.season.id, f.teams[0]!.id, playerCard.id),
      f.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    )).rejects.toMatchObject({ code: 'PLAYER_AUTO_BUILD_MISSING' });
  });

  it.each([
    { status: 'ARCHIVED' as const, teamNumber: 1 },
    { status: 'NEEDS_NUMBER' as const, teamNumber: null }
  ])('rejects an ineligible $status team', async ({ status, teamNumber }) => {
    const f = await fixture();
    await prisma.leagueTeam.update({
      where: { id: f.teams[0]!.id },
      data: { status, teamNumber }
    });
    const player = await card(f.source.id, `Ineligible ${status}`);

    await expect(service.acquire(
      acquisition(f.season.id, f.teams[0]!.id, player.card.id),
      f.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    )).rejects.toMatchObject({ code: 'LEAGUE_TEAM_NOT_ELIGIBLE' });
  });

  it('allows salary exactly at the cap and releases with immutable history and income', async () => {
    const f = await fixture({ cap: 200 });
    const player = await card(f.source.id, 'Exact cap');
    const acquired = await service.acquire(
      acquisition(f.season.id, f.teams[0]!.id, player.card.id),
      f.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    );

    const released = await service.release({
      seasonId: f.season.id,
      ownershipId: acquired.ownership.id,
      amountMinor: 500,
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      reason: 'Sold'
    }, f.admin.id, new Date('2026-09-15T00:00:00.000Z'));

    expect(released.summary).toMatchObject({ rosterCount: 0, salaryMinor: 0 });
    await expect(prisma.rosterTransaction.count({ where: { leagueId: f.league.id } })).resolves.toBe(2);
    const ledger = await prisma.financeLedgerEntry.findMany({
      where: { leagueId: f.league.id },
      select: { direction: true, amountMinor: true }
    });
    expect(ledger).toHaveLength(2);
    expect(ledger).toEqual(expect.arrayContaining([
      { direction: 'DEBIT', amountMinor: 1_000 },
      { direction: 'CREDIT', amountMinor: 500 }
    ]));
  });

  it('rejects player 26 without changing the existing roster', async () => {
    const f = await fixture({ cap: 100_000 });
    const rule = await prisma.leagueSalaryRuleVersion.findFirstOrThrow({
      where: { leagueId: f.league.id }
    });
    for (let index = 0; index < 25; index += 1) {
      const player = await card(f.source.id, `Roster limit ${index}`);
      await prisma.leaguePlayerOwnership.create({
        data: {
          leagueId: f.league.id,
          leagueTeamId: f.teams[0]!.id,
          footballPlayerId: player.player.id,
          currentPlayerCardId: player.card.id,
          dtRatingSnapshot: 93,
          salaryRuleVersionId: rule.id,
          salaryMinor: 200
        }
      });
    }
    const overflow = await card(f.source.id, 'Roster limit overflow');

    await expect(service.acquire(
      acquisition(f.season.id, f.teams[0]!.id, overflow.card.id),
      f.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    )).rejects.toMatchObject({ code: 'TEAM_ROSTER_FULL' });
    await expect(prisma.leaguePlayerOwnership.count({
      where: { leagueTeamId: f.teams[0]!.id, status: 'ACTIVE' }
    })).resolves.toBe(25);
    await expect(prisma.rosterTransaction.count({ where: { leagueId: f.league.id } })).resolves.toBe(0);
  });

  it('rolls back ownership and transaction when the ledger write fails', async () => {
    const f = await fixture();
    const player = await card(f.source.id, 'Rollback');
    const input = acquisition(f.season.id, f.teams[0]!.id, player.card.id);
    const failingAudit = {
      record: () => {
        throw new Error('forced audit failure');
      }
    } as unknown as AuditLogService;
    const rollbackService = new RosterTransactionsService(
      prisma,
      authorization,
      new AdminMutationReceiptService(prisma),
      failingAudit,
      salaryRules,
      windows,
      new RosterLockRepository()
    );

    await expect(rollbackService.acquire(
      input,
      f.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    )).rejects.toThrow('forced audit failure');
    await expect(prisma.leaguePlayerOwnership.count({ where: { leagueId: f.league.id } })).resolves.toBe(0);
    await expect(prisma.rosterTransaction.count({ where: { leagueId: f.league.id } })).resolves.toBe(0);
    await expect(prisma.financeLedgerEntry.count({ where: { leagueId: f.league.id } })).resolves.toBe(0);
  });
});
