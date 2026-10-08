import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { MutationReceiptService } from '../competitions/mutation-receipt.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { SeasonEntriesService } from './season-entries.service.js';

config({ path: '../../.env', quiet: true });

describe('SeasonEntriesService', () => {
  const prisma = new PrismaService();
  const receipts = new MutationReceiptService(prisma);
  const service = new SeasonEntriesService(prisma, receipts);
  const suffix = randomUUID();
  const leagueIds: string[] = [];
  const userIds: string[] = [];
  const accountIds: string[] = [];
  const profileIds: string[] = [];
  const catalogIds: string[] = [];
  let actorId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const actor = await prisma.user.create({
      data: { wechatOpenId: `entry-admin-${suffix}`, displayName: '报名管理员' }
    });
    actorId = actor.id;
    userIds.push(actor.id);
  });

  afterAll(async () => {
    await prisma.seasonEntryStatusHistory.deleteMany({
      where: { seasonEntry: { season: { leagueId: { in: leagueIds } } } }
    });
    await prisma.seasonEntry.updateMany({
      where: { season: { leagueId: { in: leagueIds } } },
      data: { previousSeasonEntryId: null }
    });
    await prisma.seasonEntry.deleteMany({ where: { season: { leagueId: { in: leagueIds } } } });
    await prisma.leagueSeasonStatusHistory.deleteMany({
      where: { season: { leagueId: { in: leagueIds } } }
    });
    await prisma.leagueSeason.updateMany({
      where: { leagueId: { in: leagueIds } },
      data: { previousSeasonId: null }
    });
    await prisma.leagueSeason.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await prisma.mutationReceipt.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.userRoleBinding.deleteMany({
      where: { OR: [{ userId: { in: userIds } }, { scopeId: { in: leagueIds } }] }
    });
    await prisma.leagueTeam.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await prisma.teamCatalogItem.deleteMany({ where: { id: { in: catalogIds } } });
    await prisma.league.deleteMany({ where: { id: { in: leagueIds } } });
    await prisma.teamProfile.deleteMany({ where: { id: { in: profileIds } } });
    await prisma.gameAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function createOwner(label: string, platform: 'MOBILE' | 'PLAYSTATION' = 'MOBILE') {
    const user = await prisma.user.create({
      data: { wechatOpenId: `entry-${label}-${suffix}`, displayName: label }
    });
    userIds.push(user.id);
    const account = await prisma.gameAccount.create({
      data: {
        userId: user.id,
        platform,
        serverRegion: 'GLOBAL',
        gamerTag: `${label}-tag`,
        gameUid: `${label}-uid`,
        isDefault: true
      }
    });
    accountIds.push(account.id);
    const profile = await prisma.teamProfile.create({
      data: {
        ownerUserId: user.id,
        name: `${label}球队`,
        shortName: label,
        defaultGameAccountId: account.id
      }
    });
    profileIds.push(profile.id);
    return { user, account, profile };
  }

  async function createSeason(label: string, status: 'REGISTRATION_OPEN' | 'ALLOCATION_REVIEW' = 'REGISTRATION_OPEN') {
    const now = Date.now();
    const league = await prisma.league.create({
      data: {
        name: `${label}联赛`,
        shortName: label,
        defaultPlatform: 'MOBILE',
        defaultServerRegion: 'GLOBAL',
        createdById: actorId
      }
    });
    leagueIds.push(league.id);
    const season = await prisma.leagueSeason.create({
      data: {
        leagueId: league.id,
        seasonNumber: 1,
        displayName: `${label} S1`,
        isFirstSeason: true,
        registrationOpensAt: new Date(now - 60_000),
        registrationClosesAt: new Date(now + 60_000),
        startsAt: new Date(now + 120_000),
        endsAt: new Date(now + 3_600_000),
        superCapacity: 23,
        championCapacity: 18,
        promotionCount: 4,
        status,
        createdById: actorId
      }
    });
    return { league, season };
  }

  async function assignTeam(
    owner: Awaited<ReturnType<typeof createOwner>>,
    leagueId: string,
    name = `${owner.user.displayName}球队`,
    teamNumber = 1
  ) {
    const shell = await prisma.teamCatalogItem.create({
      data: { sourceType: 'CUSTOM', nameZh: name, shortName: owner.user.displayName }
    });
    catalogIds.push(shell.id);
    return prisma.leagueTeam.create({
      data: {
        leagueId,
        ownerUserId: owner.user.id,
        ownerAlias: owner.user.displayName,
        catalogTeamId: shell.id,
        teamNumber,
        name,
        shortName: owner.user.displayName,
        defaultGameAccountId: owner.account.id
      }
    });
  }

  it('creates one idempotent application with immutable identity snapshots', async () => {
    const owner = await createOwner('新申请');
    const { user, account } = owner;
    const { league, season } = await createSeason('申请');
    const team = await assignTeam(owner, league.id);
    const key = randomUUID();
    const entry = await service.apply(user.id, season.id, { gameAccountId: account.id }, key);
    expect(entry).toMatchObject({
      source: 'NEW_APPLICATION',
      status: 'PENDING',
      teamNameSnapshot: '新申请球队',
      gamerTagSnapshot: '新申请-tag'
    });
    await expect(service.apply(user.id, season.id, { gameAccountId: account.id }, key))
      .resolves.toEqual(entry);
    await expect(service.apply(user.id, season.id, { gameAccountId: account.id }, randomUUID()))
      .rejects.toMatchObject({ code: 'SEASON_ENTRY_ALREADY_EXISTS' });

    await prisma.leagueTeam.update({ where: { id: team.id }, data: { name: '已改名球队' } });
    await prisma.gameAccount.update({ where: { id: account.id }, data: { gamerTag: '已改名玩家' } });
    await expect(service.getMine(user.id, season.id)).resolves.toMatchObject({
      teamNameSnapshot: '新申请球队',
      gamerTagSnapshot: '新申请-tag'
    });
  });

  it('rejects an ineligible account platform', async () => {
    const owner = await createOwner('平台不符', 'PLAYSTATION');
    const { user, account } = owner;
    const { league, season } = await createSeason('平台');
    await assignTeam(owner, league.id);
    await expect(service.apply(user.id, season.id, { gameAccountId: account.id }, randomUUID()))
      .rejects.toMatchObject({ code: 'GAME_ACCOUNT_INELIGIBLE' });
  });

  it('rejects a season application from a withdrawn league team', async () => {
    const owner = await createOwner('已退赛');
    const { league, season } = await createSeason('退赛申请');
    const team = await assignTeam(owner, league.id);
    await prisma.leagueTeam.update({ where: { id: team.id }, data: { status: 'ARCHIVED' } });

    await expect(service.apply(owner.user.id, season.id, {
      gameAccountId: owner.account.id
    }, randomUUID())).rejects.toMatchObject({ code: 'LEAGUE_TEAM_REQUIRED' });
    await expect(prisma.seasonEntry.count({ where: { seasonId: season.id } })).resolves.toBe(0);
  });

  it('refreshes a renewal invitation snapshot before confirming it', async () => {
    const owner = await createOwner('续赛');
    const { user, account, profile } = owner;
    const { league, season } = await createSeason('续赛');
    const team = await assignTeam(owner, league.id);
    const invitation = await prisma.seasonEntry.create({
      data: {
        seasonId: season.id,
        teamProfileId: profile.id,
        leagueTeamId: team.id,
        ownerUserId: user.id,
        gameAccountId: account.id,
        source: 'RENEWAL',
        status: 'INVITED',
        teamNameSnapshot: '旧球队',
        teamShortNameSnapshot: '旧名',
        teamNumberSnapshot: 1,
        gamePlatformSnapshot: 'MOBILE',
        serverRegionSnapshot: 'GLOBAL',
        gamerTagSnapshot: '旧玩家'
      }
    });
    await prisma.leagueTeam.update({ where: { id: team.id }, data: { name: '续赛新球队' } });
    const confirmed = await service.confirmRenewal(user.id, season.id, {
      gameAccountId: account.id,
      expectedVersion: invitation.version
    }, randomUUID());
    expect(confirmed).toMatchObject({
      status: 'APPROVED',
      teamNameSnapshot: '续赛新球队',
      gamerTagSnapshot: '续赛-tag'
    });
    expect(confirmed.confirmedAt).not.toBeNull();
  });

  it('withdraws during registration and rejects player mutations after close', async () => {
    const first = await createOwner('撤回');
    const { league, season } = await createSeason('撤回');
    await assignTeam(first, league.id);
    const entry = await service.apply(first.user.id, season.id, {
      gameAccountId: first.account.id
    }, randomUUID());
    const withdrawn = await service.withdraw(first.user.id, season.id, {
      expectedVersion: entry.version
    }, randomUUID());
    expect(withdrawn.status).toBe('WITHDRAWN');

    const second = await createOwner('截止');
    await assignTeam(second, league.id, '截止球队', 2);
    await prisma.leagueSeason.update({
      where: { id: season.id },
      data: { status: 'ALLOCATION_REVIEW' }
    });
    await expect(service.apply(second.user.id, season.id, {
      gameAccountId: second.account.id
    }, randomUUID())).rejects.toMatchObject({ code: 'SEASON_REGISTRATION_CLOSED' });
  });

  it('reviews pending entries, rejects stale versions, and filters the manager queue', async () => {
    const owner = await createOwner('审核');
    const { user, account } = owner;
    const { league, season } = await createSeason('审核');
    await assignTeam(owner, league.id);
    const entry = await service.apply(user.id, season.id, { gameAccountId: account.id }, randomUUID());
    const approved = await service.review(actorId, season.id, entry.id, {
      decision: 'APPROVE',
      expectedVersion: entry.version
    }, randomUUID());
    expect(approved).toMatchObject({ status: 'APPROVED', reviewedById: actorId });
    await expect(service.review(actorId, season.id, entry.id, {
      decision: 'REJECT',
      expectedVersion: entry.version,
      reason: '资料不符'
    }, randomUUID())).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await expect(service.listForManager(season.id, { status: 'APPROVED' }))
      .resolves.toEqual([expect.objectContaining({ id: entry.id })]);
  });

  it('requires a reason for a manager override and records the override after close', async () => {
    const owner = await createOwner('特殊处理');
    const { user, account } = owner;
    const { league, season } = await createSeason('特殊处理');
    await assignTeam(owner, league.id);
    const entry = await service.apply(user.id, season.id, { gameAccountId: account.id }, randomUUID());
    await prisma.leagueSeason.update({
      where: { id: season.id },
      data: { status: 'ALLOCATION_REVIEW' }
    });
    await expect(service.override(actorId, season.id, entry.id, {
      targetStatus: 'APPROVED',
      expectedVersion: entry.version,
      reason: '   '
    }, randomUUID())).rejects.toMatchObject({ code: 'SEASON_ENTRY_OVERRIDE_REASON_REQUIRED' });
    const overridden = await service.override(actorId, season.id, entry.id, {
      targetStatus: 'APPROVED',
      expectedVersion: entry.version,
      reason: '线下已核验'
    }, randomUUID());
    expect(overridden.status).toBe('APPROVED');
    await expect(prisma.seasonEntryStatusHistory.findFirst({
      where: { seasonEntryId: entry.id, toStatus: 'APPROVED' }
    })).resolves.toMatchObject({ reason: '线下已核验', actorId });
  });
});
