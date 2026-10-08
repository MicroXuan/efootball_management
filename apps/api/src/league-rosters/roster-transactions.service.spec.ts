import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { config } from 'dotenv';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AdminLeagueSeasonsService } from '../admin/admin-league-seasons.service.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { PlayerBuildsService } from '../player-builds/player-builds.service.js';
import { RosterLockRepository } from './roster-lock.repository.js';
import { RosterTransactionsService } from './roster-transactions.service.js';
import { SalaryRecalculationService } from './salary-recalculation.service.js';
import { SalaryRulesService, defaultSalaryTiers } from './salary-rules.service.js';
import { TransferWindowsService } from './transfer-windows.service.js';
import { TransactionFeesService } from '../league-economy/transaction-fees.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { ValuationSnapshotsService } from '../player-valuations/valuation-snapshots.service.js';
import { ValuationWindowsService as PlayerValuationWindowsService } from '../player-valuations/valuation-windows.service.js';

config({ path: '../../.env', quiet: true });

describe('RosterTransactionsService', () => {
  const prisma = new PrismaService();
  const authorization = new AdminAuthorizationService(prisma);
  const audit = new AuditLogService(prisma);
  const salaryRules = new SalaryRulesService(prisma, authorization, audit);
  const windows = new TransferWindowsService(prisma, authorization, audit);
  const transactionFees = new TransactionFeesService(
    prisma,
    authorization,
    new AdminMutationReceiptService(prisma),
    audit
  );
  const valuationSnapshots = {
    synchronizeSeasonBeforeRosterMutation: jest.fn(async () => undefined)
  } as unknown as ValuationSnapshotsService;
  const service = new RosterTransactionsService(
    prisma,
    authorization,
    new AdminMutationReceiptService(prisma),
    audit,
    salaryRules,
    windows,
    new RosterLockRepository(),
    transactionFees,
    valuationSnapshots,
    new PlayerBuildsService(prisma)
  );
  const recalculation = new SalaryRecalculationService(
    prisma,
    authorization,
    new AdminMutationReceiptService(prisma),
    audit,
    salaryRules,
    new RosterLockRepository()
  );
  const createdLeagueIds: string[] = [];
  const createdAdminIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdSourceIds: string[] = [];
  const createdCatalogIds: string[] = [];

  beforeAll(() => prisma.$connect());

  afterEach(async () => {
    jest.mocked(valuationSnapshots.synchronizeSeasonBeforeRosterMutation).mockClear();
    await prisma.adminMutationReceipt.deleteMany({ where: { adminId: { in: createdAdminIds } } });
    await prisma.auditLog.deleteMany({ where: { leagueId: { in: createdLeagueIds } } });
    await prisma.financeLedgerEntry.deleteMany({ where: { leagueId: { in: createdLeagueIds } } });
    await prisma.rosterTransaction.deleteMany({ where: { leagueId: { in: createdLeagueIds } } });
    await prisma.valuationRosterSnapshot.deleteMany({
      where: { window: { season: { leagueId: { in: createdLeagueIds } } } }
    });
    await prisma.valuationWindow.updateMany({
      where: { season: { leagueId: { in: createdLeagueIds } } },
      data: { currentRuleVersionId: null }
    });
    await prisma.valuationWindowRuleVersion.deleteMany({
      where: { window: { season: { leagueId: { in: createdLeagueIds } } } }
    });
    await prisma.valuationWindow.deleteMany({
      where: { season: { leagueId: { in: createdLeagueIds } } }
    });
    await prisma.leaguePlayerOwnership.deleteMany({ where: { leagueId: { in: createdLeagueIds } } });
    await prisma.leaguePlayerValuation.deleteMany({ where: { leagueId: { in: createdLeagueIds } } });
    await prisma.leagueTransactionFeeRuleVersion.deleteMany({ where: { leagueId: { in: createdLeagueIds } } });
    await prisma.transferWindow.deleteMany({ where: { season: { leagueId: { in: createdLeagueIds } } } });
    await prisma.seasonEntry.deleteMany({ where: { season: { leagueId: { in: createdLeagueIds } } } });
    await prisma.leagueSalaryRuleVersion.deleteMany({ where: { leagueId: { in: createdLeagueIds } } });
    await prisma.adminLeagueRole.deleteMany({ where: { adminId: { in: createdAdminIds } } });
    await prisma.leagueTeam.deleteMany({ where: { leagueId: { in: createdLeagueIds } } });
    await prisma.teamCatalogItem.deleteMany({ where: { id: { in: createdCatalogIds } } });
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
    createdLeagueIds.length = createdAdminIds.length = createdUserIds.length = createdSourceIds.length = createdCatalogIds.length = 0;
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
    const teams = await Promise.all(users.map(async (user, index) => {
      const shell = await prisma.teamCatalogItem.create({
        data: { sourceType: 'CUSTOM', nameZh: `Team ${index + 1}`, shortName: `T${index + 1}` }
      });
      createdCatalogIds.push(shell.id);
      return prisma.leagueTeam.create({ data: {
        leagueId: league.id,
        ownerUserId: user.id,
        ownerAlias: user.displayName,
        catalogTeamId: shell.id,
        teamNumber: index + 1,
        name: `Team ${index + 1}`,
        shortName: `T${index + 1}`
      } });
    }));
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
    const input = {
      seasonId: f.season.id,
      targetLeagueTeamId: f.teams[0]!.id,
      playerCardId: player.card.id,
      amountMinor: 1_000,
      idempotencyKey: 'same-key'
    };

    const operationAt = new Date('2026-09-15T00:00:00.000Z');
    const first = await service.acquire(input as never, f.admin.id, operationAt);
    expect(valuationSnapshots.synchronizeSeasonBeforeRosterMutation).toHaveBeenCalledWith(
      expect.anything(),
      f.season.id
    );
    const replay = await service.acquire(input as never, f.admin.id, new Date('2026-09-15T00:00:00.000Z'));

    expect(replay).toEqual(first);
    expect(first.transaction.reason).toBe('购买球员（未填写原因）');
    expect(first.summary).toMatchObject({ rosterCount: 1, salaryMinor: 200, salaryCapMinor: 10_000 });
    await expect(prisma.rosterTransaction.count({ where: { leagueId: f.league.id } })).resolves.toBe(1);
    await expect(prisma.financeLedgerEntry.count({ where: { leagueId: f.league.id } })).resolves.toBe(1);
  });

  it('snapshots the opening roster before a request blocked across startsAt mutates it', async () => {
    const f = await fixture();
    const existing = await card(f.source.id, 'Opening roster');
    const late = await card(f.source.id, 'Boundary signing');
    await service.acquire(
      acquisition(f.season.id, f.teams[0]!.id, existing.card.id),
      f.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    );
    await prisma.seasonEntry.create({
      data: {
        seasonId: f.season.id,
        leagueTeamId: f.teams[0]!.id,
        ownerUserId: f.users[0]!.id,
        source: 'NEW_APPLICATION',
        status: 'APPROVED',
        teamNameSnapshot: f.teams[0]!.name,
        teamShortNameSnapshot: f.teams[0]!.shortName,
        teamNumberSnapshot: f.teams[0]!.teamNumber
      }
    });
    const startsAt = new Date(Date.now() + 750);
    const valuationWindow = await prisma.valuationWindow.create({
      data: {
        seasonId: f.season.id,
        name: '边界快照',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60_000),
        createdByAdminId: f.admin.id
      }
    });
    const valuationWindows = new PlayerValuationWindowsService(
      prisma,
      authorization,
      audit,
      new AdminMutationReceiptService(prisma)
    );
    const realSnapshots = new ValuationSnapshotsService(prisma, valuationWindows);
    const boundaryService = new RosterTransactionsService(
      prisma,
      authorization,
      new AdminMutationReceiptService(prisma),
      audit,
      salaryRules,
      windows,
      new RosterLockRepository(),
      transactionFees,
      realSnapshots,
      new PlayerBuildsService(prisma)
    );

    let releaseWindowLock: () => void = () => undefined;
    let reportWindowLocked: () => void = () => undefined;
    const windowLocked = new Promise<void>((resolve) => { reportWindowLocked = resolve; });
    const holdWindowLock = new Promise<void>((resolve) => { releaseWindowLock = resolve; });
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM valuation_windows WHERE id = ${valuationWindow.id} FOR UPDATE
      `);
      reportWindowLocked();
      await holdWindowLock;
    });
    await windowLocked;

    const requestedAt = new Date();
    const acquisitionPromise = boundaryService.acquire(
      acquisition(f.season.id, f.teams[0]!.id, late.card.id),
      f.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    );
    expect(requestedAt.getTime()).toBeLessThan(startsAt.getTime());
    await new Promise((resolve) => setTimeout(resolve, startsAt.getTime() - Date.now() + 100));
    releaseWindowLock();
    await blocker;
    await acquisitionPromise;

    const snapshots = await prisma.valuationRosterSnapshot.findMany({
      where: { windowId: valuationWindow.id },
      select: { footballPlayerId: true }
    });
    expect(snapshots).toEqual([{ footballPlayerId: existing.player.id }]);
    expect(snapshots).not.toContainEqual({ footballPlayerId: late.player.id });
  });

  it('freezes approved teams before an enrollment blocked across startsAt completes', async () => {
    const f = await fixture();
    const existing = await card(f.source.id, 'Late enrolled roster');
    await service.acquire(
      acquisition(f.season.id, f.teams[0]!.id, existing.card.id),
      f.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    );
    const startsAt = new Date(Date.now() + 750);
    const valuationWindow = await prisma.valuationWindow.create({
      data: {
        seasonId: f.season.id,
        name: '报名边界快照',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60_000),
        createdByAdminId: f.admin.id
      }
    });
    const enrollmentService = new AdminLeagueSeasonsService(
      prisma,
      authorization,
      new AdminMutationReceiptService(prisma),
      audit
    );

    let releaseWindowLock: () => void = () => undefined;
    let reportWindowLocked: () => void = () => undefined;
    const windowLocked = new Promise<void>((resolve) => { reportWindowLocked = resolve; });
    const holdWindowLock = new Promise<void>((resolve) => { releaseWindowLock = resolve; });
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM valuation_windows WHERE id = ${valuationWindow.id} FOR UPDATE
      `);
      reportWindowLocked();
      await holdWindowLock;
    });
    await windowLocked;

    const requestedAt = new Date();
    const enrollment = enrollmentService.enrollTeams(
      f.admin.id,
      f.league.id,
      f.season.id,
      { leagueTeamIds: [f.teams[0]!.id], expectedSeasonVersion: f.season.version },
      randomUUID()
    );
    expect(requestedAt.getTime()).toBeLessThan(startsAt.getTime());
    await new Promise((resolve) => setTimeout(resolve, startsAt.getTime() - Date.now() + 100));
    releaseWindowLock();
    await blocker;
    await enrollment;

    await expect(prisma.valuationRosterSnapshot.count({
      where: { windowId: valuationWindow.id }
    })).resolves.toBe(0);
    await expect(prisma.seasonEntry.count({
      where: { seasonId: f.season.id, leagueTeamId: f.teams[0]!.id, status: 'APPROVED' }
    })).resolves.toBe(1);
    await expect(prisma.valuationWindow.findUniqueOrThrow({
      where: { id: valuationWindow.id },
      select: { snapshotInitializedAt: true }
    })).resolves.toEqual({ snapshotInitializedAt: expect.any(Date) });
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

  it('uses the automatic build total when legacy DT is missing, and rejects window or cap violations', async () => {
    const missing = await fixture();
    const noDt = await card(missing.source.id, 'Missing DT', null);
    await expect(service.acquire(
      acquisition(missing.season.id, missing.teams[0]!.id, noDt.card.id),
      missing.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    )).resolves.toMatchObject({ ownership: { dtRating: 93, salaryMinor: 200 } });

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

  it('backfills and uses the automatic build total when acquiring a legacy PESDATA card', async () => {
    const f = await fixture();
    const player = await prisma.footballPlayer.create({ data: { nameEn: 'Guido Rodriguez' } });
    const playerCard = await prisma.playerCard.create({
      data: {
        sourceId: f.source.id,
        externalId: `legacy-build-${randomUUID()}`,
        playerId: player.id,
        cardName: 'Spanish League Selection Midfielders',
        position: 'DMF',
        overallRating: 80,
        cardType: 'HIGHLIGHT',
        attributes: {
          create: { attributesJson: { sourceMetadata: { maxLevel: 80 } } }
        }
      }
    });

    const result = await service.acquire(
      acquisition(f.season.id, f.teams[0]!.id, playerCard.id),
      f.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    );

    expect(result.ownership).toMatchObject({
      currentPlayerCardId: playerCard.id,
      dtRating: 95,
      salaryMinor: 400
    });
    await expect(prisma.playerCardAutoBuild.findFirst({ where: { playerCardId: playerCard.id } }))
      .resolves.toMatchObject({ maxOverall: 95, dtRating: 95 });
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
      new RosterLockRepository(),
      transactionFees,
      valuationSnapshots,
      new PlayerBuildsService(prisma)
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

  it('transfers a player atomically with paired finance entries', async () => {
    const f = await fixture();
    const player = await card(f.source.id, 'Transfer');
    const acquired = await service.acquire(
      acquisition(f.season.id, f.teams[0]!.id, player.card.id),
      f.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    );

    const transferInput = {
      seasonId: f.season.id,
      ownershipId: acquired.ownership.id,
      targetLeagueTeamId: f.teams[1]!.id,
      amountMinor: 700,
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      reason: 'Team transfer'
    };
    const transferred = await service.transfer(
      transferInput,
      f.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    );
    const replay = await service.transfer(
      transferInput,
      f.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    );

    expect(replay).toEqual(transferred);
    expect(transferred.ownership).toMatchObject({ leagueTeamId: f.teams[1]!.id, version: 2 });
    await expect(prisma.rosterTransaction.count({ where: { leagueId: f.league.id } })).resolves.toBe(2);
    const transferLedger = await prisma.financeLedgerEntry.findMany({
      where: { rosterTransaction: { type: 'TRANSFER', leagueId: f.league.id } },
      select: { leagueTeamId: true, direction: true, amountMinor: true }
    });
    expect(transferLedger).toEqual(expect.arrayContaining([
      { leagueTeamId: f.teams[0]!.id, direction: 'CREDIT', amountMinor: 700 },
      { leagueTeamId: f.teams[1]!.id, direction: 'DEBIT', amountMinor: 700 }
    ]));
  });

  it('locks transfer teams in stable order so opposite transfers complete without deadlock', async () => {
    const f = await fixture();
    const first = await card(f.source.id, 'Opposite A');
    const second = await card(f.source.id, 'Opposite B');
    const [ownedA, ownedB] = await Promise.all([
      service.acquire(acquisition(f.season.id, f.teams[0]!.id, first.card.id), f.admin.id,
        new Date('2026-09-15T00:00:00.000Z')),
      service.acquire(acquisition(f.season.id, f.teams[1]!.id, second.card.id), f.admin.id,
        new Date('2026-09-15T00:00:00.000Z'))
    ]);

    const results = await Promise.all([
      service.transfer({
        seasonId: f.season.id,
        ownershipId: ownedA.ownership.id,
        targetLeagueTeamId: f.teams[1]!.id,
        amountMinor: null,
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
        reason: 'A to B'
      }, f.admin.id, new Date('2026-09-15T00:00:00.000Z')),
      service.transfer({
        seasonId: f.season.id,
        ownershipId: ownedB.ownership.id,
        targetLeagueTeamId: f.teams[0]!.id,
        amountMinor: null,
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
        reason: 'B to A'
      }, f.admin.id, new Date('2026-09-15T00:00:00.000Z'))
    ]);

    expect(results.map(({ ownership }) => ownership.leagueTeamId).sort())
      .toEqual(f.teams.map(({ id }) => id).sort());
  });

  it('rejects transfers into a full or over-cap target team', async () => {
    const capped = await fixture({ cap: 200 });
    const sourcePlayer = await card(capped.source.id, 'Transfer cap source');
    const targetPlayer = await card(capped.source.id, 'Transfer cap target');
    const sourceOwned = await service.acquire(
      acquisition(capped.season.id, capped.teams[0]!.id, sourcePlayer.card.id),
      capped.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    );
    await service.acquire(
      acquisition(capped.season.id, capped.teams[1]!.id, targetPlayer.card.id),
      capped.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    );
    await expect(service.transfer({
      seasonId: capped.season.id,
      ownershipId: sourceOwned.ownership.id,
      targetLeagueTeamId: capped.teams[1]!.id,
      amountMinor: null,
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      reason: 'Over cap transfer'
    }, capped.admin.id, new Date('2026-09-15T00:00:00.000Z')))
      .rejects.toMatchObject({ code: 'TEAM_SALARY_CAP_EXCEEDED' });

    const full = await fixture({ cap: 100_000 });
    const moving = await card(full.source.id, 'Transfer full source');
    const movingOwned = await service.acquire(
      acquisition(full.season.id, full.teams[0]!.id, moving.card.id),
      full.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    );
    const rule = await prisma.leagueSalaryRuleVersion.findFirstOrThrow({
      where: { leagueId: full.league.id }
    });
    for (let index = 0; index < 25; index += 1) {
      const seeded = await card(full.source.id, `Full transfer ${index}`);
      await prisma.leaguePlayerOwnership.create({
        data: {
          leagueId: full.league.id,
          leagueTeamId: full.teams[1]!.id,
          footballPlayerId: seeded.player.id,
          currentPlayerCardId: seeded.card.id,
          dtRatingSnapshot: 93,
          salaryRuleVersionId: rule.id,
          salaryMinor: 200
        }
      });
    }
    await expect(service.transfer({
      seasonId: full.season.id,
      ownershipId: movingOwned.ownership.id,
      targetLeagueTeamId: full.teams[1]!.id,
      amountMinor: null,
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      reason: 'Full target transfer'
    }, full.admin.id, new Date('2026-09-15T00:00:00.000Z')))
      .rejects.toMatchObject({ code: 'TEAM_ROSTER_FULL' });
  });

  it('upgrades only to another card of the same player and checks the resulting salary', async () => {
    const f = await fixture({ cap: 200 });
    const player = await card(f.source.id, 'Upgrade base', 93);
    const acquired = await service.acquire(
      acquisition(f.season.id, f.teams[0]!.id, player.card.id),
      f.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    );
    const wrong = await card(f.source.id, 'Wrong player', 92);
    await expect(service.upgradeCard({
      seasonId: f.season.id,
      ownershipId: acquired.ownership.id,
      newPlayerCardId: wrong.card.id,
      amountMinor: null,
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      reason: 'Wrong upgrade'
    }, f.admin.id, new Date('2026-09-15T00:00:00.000Z')))
      .rejects.toMatchObject({ code: 'PLAYER_CARD_IDENTITY_MISMATCH' });

    const expensive = await prisma.playerCard.create({
      data: {
        sourceId: f.source.id,
        externalId: `upgrade-${randomUUID()}`,
        playerId: player.player.id,
        cardName: 'Upgrade expensive',
        position: 'CB',
        overallRating: 94,
        cardType: 'EPIC'
      }
    });
    await new PlayerBuildsService(prisma).save(expensive.id, {
      autoBuildAllocation: { defending: 11 },
      autoBuildMaxOverall: 94,
      dtRating: 94,
      algorithmVersion: 'test-v1'
    });
    await expect(prisma.leaguePlayerOwnership.findUniqueOrThrow({
      where: { id: acquired.ownership.id },
      select: { currentPlayerCardId: true }
    })).resolves.toEqual({ currentPlayerCardId: player.card.id });
    await expect(service.upgradeCard({
      seasonId: f.season.id,
      ownershipId: acquired.ownership.id,
      newPlayerCardId: expensive.id,
      amountMinor: 300,
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      reason: 'Explicit upgrade'
    }, f.admin.id, new Date('2026-09-15T00:00:00.000Z')))
      .rejects.toMatchObject({ code: 'TEAM_SALARY_CAP_EXCEEDED' });
  });

  it('upgrades a card only after an explicit action and records its cost', async () => {
    const f = await fixture({ cap: 1_000 });
    const player = await card(f.source.id, 'Upgrade success', 93);
    const acquired = await service.acquire(
      acquisition(f.season.id, f.teams[0]!.id, player.card.id),
      f.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    );
    const upgrade = await prisma.playerCard.create({
      data: {
        sourceId: f.source.id,
        externalId: `upgrade-success-${randomUUID()}`,
        playerId: player.player.id,
        cardName: 'Upgrade success 94',
        position: 'CB',
        overallRating: 94,
        cardType: 'EPIC'
      }
    });
    await new PlayerBuildsService(prisma).save(upgrade.id, {
      autoBuildAllocation: { defending: 11 },
      autoBuildMaxOverall: 94,
      dtRating: 94,
      algorithmVersion: 'test-v1'
    });
    await expect(prisma.leaguePlayerOwnership.findUniqueOrThrow({
      where: { id: acquired.ownership.id }, select: { currentPlayerCardId: true }
    })).resolves.toEqual({ currentPlayerCardId: player.card.id });

    const upgraded = await service.upgradeCard({
      seasonId: f.season.id,
      ownershipId: acquired.ownership.id,
      newPlayerCardId: upgrade.id,
      amountMinor: 300,
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      reason: 'Explicit successful upgrade'
    }, f.admin.id, new Date('2026-09-15T00:00:00.000Z'));

    expect(upgraded.ownership).toMatchObject({
      currentPlayerCardId: upgrade.id,
      dtRating: 94,
      salaryMinor: 300,
      version: 2
    });
    await expect(prisma.financeLedgerEntry.count({
      where: { rosterTransaction: { type: 'CARD_UPGRADE', leagueId: f.league.id } }
    })).resolves.toBe(1);
  });

  it('rejects an equal-salary card change while over cap but permits a salary reduction', async () => {
    const f = await fixture({ cap: 1_000 });
    const player = await card(f.source.id, 'Over cap upgrade', 94);
    const acquired = await service.acquire(
      acquisition(f.season.id, f.teams[0]!.id, player.card.id),
      f.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    );
    const equalSalaryCard = await prisma.playerCard.create({
      data: {
        sourceId: f.source.id,
        externalId: `equal-salary-${randomUUID()}`,
        playerId: player.player.id,
        cardName: 'Equal salary variant',
        position: 'CB',
        overallRating: 94,
        cardType: 'EPIC'
      }
    });
    const lowerSalaryCard = await prisma.playerCard.create({
      data: {
        sourceId: f.source.id,
        externalId: `lower-salary-${randomUUID()}`,
        playerId: player.player.id,
        cardName: 'Lower salary variant',
        position: 'CB',
        overallRating: 93,
        cardType: 'STANDARD'
      }
    });
    await new PlayerBuildsService(prisma).save(equalSalaryCard.id, {
      autoBuildAllocation: { defending: 11 },
      autoBuildMaxOverall: 94,
      dtRating: 94,
      algorithmVersion: 'test-v1'
    });
    await new PlayerBuildsService(prisma).save(lowerSalaryCard.id, {
      autoBuildAllocation: { defending: 10 },
      autoBuildMaxOverall: 93,
      dtRating: 93,
      algorithmVersion: 'test-v1'
    });
    await salaryRules.createVersion(f.admin.id, f.league.id, {
      salaryCapMinor: 150,
      tiers: defaultSalaryTiers(),
      effectiveAt: '2026-09-16T00:00:00.000Z',
      expectedCurrentVersion: 1
    });

    await expect(service.upgradeCard({
      seasonId: f.season.id,
      ownershipId: acquired.ownership.id,
      newPlayerCardId: equalSalaryCard.id,
      amountMinor: null,
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      reason: 'Equal salary while over cap'
    }, f.admin.id, new Date('2026-09-17T00:00:00.000Z')))
      .rejects.toMatchObject({ code: 'TEAM_SALARY_CAP_EXCEEDED' });

    const lowered = await service.upgradeCard({
      seasonId: f.season.id,
      ownershipId: acquired.ownership.id,
      newPlayerCardId: lowerSalaryCard.id,
      amountMinor: null,
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      reason: 'Reduce salary while over cap'
    }, f.admin.id, new Date('2026-09-17T00:00:00.000Z'));
    expect(lowered.ownership).toMatchObject({ salaryMinor: 200, currentPlayerCardId: lowerSalaryCard.id });
  });

  it('denies a league manager transfer outside configured windows', async () => {
    const f = await fixture({ openWindow: false });
    const player = await card(f.source.id, 'Closed manager transfer', 93);
    const rule = await prisma.leagueSalaryRuleVersion.findFirstOrThrow({ where: { leagueId: f.league.id } });
    const ownership = await prisma.leaguePlayerOwnership.create({
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
    const manager = await prisma.adminAccount.create({
      data: {
        username: `window-manager-${randomUUID()}`,
        displayName: 'Window Manager',
        passwordHash: 'test',
        platformRole: 'LEAGUE_MANAGER'
      }
    });
    createdAdminIds.push(manager.id);
    await prisma.adminLeagueRole.create({
      data: { adminId: manager.id, leagueId: f.league.id, grantedById: f.admin.id }
    });

    await expect(service.transfer({
      seasonId: f.season.id,
      ownershipId: ownership.id,
      targetLeagueTeamId: f.teams[1]!.id,
      amountMinor: null,
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      reason: 'Outside window'
    }, manager.id, new Date('2026-09-15T00:00:00.000Z')))
      .rejects.toMatchObject({ code: 'TRANSFER_WINDOW_CLOSED' });
  });

  it('recalculates salaries without dropping players and marks over-cap teams', async () => {
    const f = await fixture({ cap: 10_000 });
    const player = await card(f.source.id, 'Recalculate', 93);
    await service.acquire(
      acquisition(f.season.id, f.teams[0]!.id, player.card.id),
      f.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    );
    const newRule = await salaryRules.createVersion(f.admin.id, f.league.id, {
      salaryCapMinor: 150,
      tiers: defaultSalaryTiers(),
      effectiveAt: '2026-09-16T00:00:00.000Z',
      expectedCurrentVersion: 1
    });

    const result = await recalculation.recalculateLeague({
      leagueId: f.league.id,
      seasonId: f.season.id,
      salaryRuleVersionId: newRule.id,
      confirm: true,
      idempotencyKey: randomUUID(),
      reason: 'Apply new salaries'
    }, f.admin.id);

    expect(result).toMatchObject({ recalculatedPlayers: 1, overCapTeams: 1 });
    await expect(prisma.leaguePlayerOwnership.count({
      where: { leagueId: f.league.id, status: 'ACTIVE' }
    })).resolves.toBe(1);
    await expect(prisma.leagueTeam.findUniqueOrThrow({
      where: { id: f.teams[0]!.id }, select: { rosterStatus: true }
    })).resolves.toEqual({ rosterStatus: 'OVER_CAP' });
  });

  it('allows only platform admins to make reasoned emergency corrections', async () => {
    const f = await fixture({ openWindow: false });
    const player = await card(f.source.id, 'Emergency', 93);
    const rule = await prisma.leagueSalaryRuleVersion.findFirstOrThrow({ where: { leagueId: f.league.id } });
    const ownership = await prisma.leaguePlayerOwnership.create({
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
    const manager = await prisma.adminAccount.create({
      data: {
        username: `manager-${randomUUID()}`,
        displayName: 'Manager',
        passwordHash: 'test',
        platformRole: 'LEAGUE_MANAGER'
      }
    });
    createdAdminIds.push(manager.id);
    await prisma.adminLeagueRole.create({
      data: { adminId: manager.id, leagueId: f.league.id, grantedById: f.admin.id }
    });
    const correction = {
      seasonId: f.season.id,
      ownershipId: ownership.id,
      targetLeagueTeamId: f.teams[1]!.id,
      newPlayerCardId: null,
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      reason: 'Correct mistaken assignment'
    };

    await expect(service.emergencyCorrect(correction, manager.id))
      .rejects.toMatchObject({ code: 'ADMIN_PLATFORM_ACCESS_DENIED' });
    await service.emergencyCorrect(correction, f.admin.id);
    await expect(prisma.auditLog.count({
      where: { leagueId: f.league.id, action: 'ROSTER_EMERGENCY_CORRECTED' }
    })).resolves.toBe(1);
    await expect(prisma.rosterTransaction.count({
      where: { leagueId: f.league.id, type: 'EMERGENCY_CORRECTION' }
    })).resolves.toBe(1);
  });

  it('marks a player disappeared or retired and restores active without deleting history', async () => {
    const f = await fixture();
    const player = await card(f.source.id, 'Lifecycle');
    const acquired = await service.acquire(
      acquisition(f.season.id, f.teams[0]!.id, player.card.id),
      f.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    );

    const disappeared = await service.updateLifecycleStatus({
      seasonId: f.season.id,
      ownershipId: acquired.ownership.id,
      status: 'DISAPPEARED',
      reason: '游戏数据库暂时移除',
      expectedVersion: acquired.ownership.version,
      idempotencyKey: randomUUID()
    }, f.admin.id);
    const retired = await service.updateLifecycleStatus({
      seasonId: f.season.id,
      ownershipId: acquired.ownership.id,
      status: 'RETIRED',
      reason: '确认退役',
      expectedVersion: disappeared.version,
      idempotencyKey: randomUUID()
    }, f.admin.id);
    const active = await service.updateLifecycleStatus({
      seasonId: f.season.id,
      ownershipId: acquired.ownership.id,
      status: 'ACTIVE',
      reason: '重新加入游戏数据库',
      expectedVersion: retired.version,
      idempotencyKey: randomUUID()
    }, f.admin.id);

    expect([disappeared.status, retired.status, active.status])
      .toEqual(['DISAPPEARED', 'RETIRED', 'ACTIVE']);
    await expect(prisma.rosterTransaction.count({ where: { leagueId: f.league.id } })).resolves.toBe(1);
    await expect(prisma.auditLog.count({
      where: { leagueId: f.league.id, action: 'ROSTER_PLAYER_LIFECYCLE_UPDATED' }
    })).resolves.toBe(3);
  });

  it('does not restore a released roster record through lifecycle maintenance', async () => {
    const f = await fixture();
    const player = await card(f.source.id, 'Released lifecycle');
    const acquired = await service.acquire(
      acquisition(f.season.id, f.teams[0]!.id, player.card.id),
      f.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    );
    const released = await service.release({
      seasonId: f.season.id,
      ownershipId: acquired.ownership.id,
      amountMinor: null,
      expectedVersion: acquired.ownership.version,
      idempotencyKey: randomUUID(),
      reason: '正常解约'
    }, f.admin.id, new Date('2026-09-15T00:00:00.000Z'));

    await expect(service.updateLifecycleStatus({
      seasonId: f.season.id,
      ownershipId: acquired.ownership.id,
      status: 'ACTIVE',
      reason: '错误恢复',
      expectedVersion: released.ownership.version,
      idempotencyKey: randomUUID()
    }, f.admin.id)).rejects.toMatchObject({ code: 'ROSTER_LIFECYCLE_CHANGE_NOT_ALLOWED' });
  });

  it('snapshots official valuation and automatic fee without changing history later', async () => {
    const f = await fixture();
    const player = await card(f.source.id, 'Fee snapshot');
    const salaryRule = await prisma.leagueSalaryRuleVersion.findFirstOrThrow({ where: { leagueId: f.league.id } });
    const ownership = await prisma.leaguePlayerOwnership.create({
      data: {
        leagueId: f.league.id, leagueTeamId: f.teams[0]!.id, footballPlayerId: player.player.id,
        currentPlayerCardId: player.card.id, dtRatingSnapshot: 93, salaryRuleVersionId: salaryRule.id,
        salaryMinor: 200
      }
    });
    const feeRule = await prisma.leagueTransactionFeeRuleVersion.create({
      data: {
        leagueId: f.league.id, version: 1, rateBps: 250, minimumFeeMinor: 300,
        effectiveAt: new Date('2026-09-01T00:00:00.000Z'), createdByAdminId: f.admin.id
      }
    });
    const valuation = await prisma.leaguePlayerValuation.create({
      data: {
        leagueId: f.league.id, footballPlayerId: player.player.id, currentValueMinor: 20_000,
        effectiveAt: new Date('2026-09-01T00:00:00.000Z')
      }
    });

    const result = await service.transfer({
      seasonId: f.season.id, ownershipId: ownership.id, targetLeagueTeamId: f.teams[1]!.id,
      amountMinor: 5000, expectedVersion: 1, idempotencyKey: randomUUID(), reason: '含自动手续费的转会'
    }, f.admin.id, new Date('2026-09-15T00:00:00.000Z'));

    expect(result.transaction).toMatchObject({
      valuationSnapshotMinor: 20_000, transactionFeeMinor: 500,
      transactionFeeRuleVersionId: feeRule.id
    });
    await expect(prisma.financeLedgerEntry.findFirstOrThrow({
      where: { rosterTransactionId: result.transaction.id, type: 'TRANSACTION_FEE' }
    })).resolves.toMatchObject({
      leagueTeamId: f.teams[1]!.id, direction: 'DEBIT', amountMinor: 500
    });
    await prisma.leaguePlayerValuation.update({
      where: { id: valuation.id }, data: { currentValueMinor: 99_000 }
    });
    await expect(prisma.rosterTransaction.findUniqueOrThrow({ where: { id: result.transaction.id } }))
      .resolves.toMatchObject({ valuationSnapshotMinor: 20_000, transactionFeeMinor: 500 });
    await expect(prisma.leaguePlayerValuation.findUniqueOrThrow({ where: { id: valuation.id } }))
      .resolves.toMatchObject({ footballPlayerId: player.player.id });
  });

  it('lets a team sign from the public pool without valuation but requires valuation for team transfers', async () => {
    const f = await fixture();
    const player = await card(f.source.id, 'No valuation fee');
    await prisma.leagueTransactionFeeRuleVersion.create({
      data: {
        leagueId: f.league.id, version: 1, rateBps: 250, minimumFeeMinor: 300,
        effectiveAt: new Date('2026-09-01T00:00:00.000Z'), createdByAdminId: f.admin.id
      }
    });

    const acquired = await service.acquire(
      acquisition(f.season.id, f.teams[0]!.id, player.card.id),
      f.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    );
    expect(acquired.transaction).toMatchObject({
      type: 'BUY',
      valuationSnapshotMinor: null,
      transactionFeeMinor: null,
      transactionFeeRuleVersionId: null
    });
    await expect(prisma.financeLedgerEntry.count({
      where: { rosterTransactionId: acquired.transaction.id, type: 'TRANSACTION_FEE' }
    })).resolves.toBe(0);

    await expect(service.transfer({
      seasonId: f.season.id,
      ownershipId: acquired.ownership.id,
      targetLeagueTeamId: f.teams[1]!.id,
      amountMinor: 1_000,
      expectedVersion: acquired.ownership.version,
      idempotencyKey: randomUUID(),
      reason: '球队之间交易'
    }, f.admin.id, new Date('2026-09-15T00:00:00.000Z')))
      .rejects.toMatchObject({ code: 'PLAYER_VALUATION_REQUIRED_FOR_FEE' });
  });

  it('allows only platform administrators to set a manual fee for a team transfer', async () => {
    const f = await fixture();
    const player = await card(f.source.id, 'Manual fee');
    const acquired = await service.acquire(
      acquisition(f.season.id, f.teams[0]!.id, player.card.id),
      f.admin.id,
      new Date('2026-09-15T00:00:00.000Z')
    );
    const manager = await prisma.adminAccount.create({
      data: {
        username: `fee-manager-${randomUUID()}`, displayName: '手续费管理员',
        passwordHash: 'test', platformRole: 'LEAGUE_MANAGER'
      }
    });
    createdAdminIds.push(manager.id);
    await prisma.adminLeagueRole.create({
      data: { adminId: manager.id, leagueId: f.league.id, grantedById: f.admin.id }
    });
    const input = {
      seasonId: f.season.id,
      ownershipId: acquired.ownership.id,
      targetLeagueTeamId: f.teams[1]!.id,
      amountMinor: 1_000,
      expectedVersion: acquired.ownership.version,
      idempotencyKey: randomUUID(),
      manualTransactionFeeMinor: 123,
      reason: '平台管理员人工手续费'
    };

    await expect(service.transfer(input, manager.id, new Date('2026-09-15T00:00:00.000Z')))
      .rejects.toMatchObject({ code: 'ADMIN_PLATFORM_ACCESS_DENIED' });
    const result = await service.transfer(input, f.admin.id, new Date('2026-09-15T00:00:00.000Z'));
    expect(result.transaction).toMatchObject({
      valuationSnapshotMinor: null, transactionFeeMinor: 123, transactionFeeRuleVersionId: null
    });
    await expect(prisma.financeLedgerEntry.count({
      where: { rosterTransactionId: result.transaction.id, type: 'TRANSACTION_FEE', amountMinor: 123 }
    })).resolves.toBe(1);
  });
});
