import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { MutationReceiptService } from '../competitions/mutation-receipt.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { LeaguesService } from './leagues.service.js';
import { SeasonsService } from './seasons.service.js';

config({ path: '../../.env', quiet: true });

describe('SeasonsService', () => {
  const prisma = new PrismaService();
  const receipts = new MutationReceiptService(prisma);
  const leagues = new LeaguesService(prisma, receipts, new AuthorizationService(prisma));
  const service = new SeasonsService(prisma, receipts);
  const suffix = randomUUID();
  const leagueIds: string[] = [];
  const userIds: string[] = [];
  const accountIds: string[] = [];
  let actorId: string;
  let teamOwnerId: string;
  let teamProfileId: string;
  let teamAccountId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const actor = await prisma.user.create({
      data: { wechatOpenId: `season-actor-${suffix}`, displayName: '赛季管理员' }
    });
    const owner = await prisma.user.create({
      data: { wechatOpenId: `season-owner-${suffix}`, displayName: '续赛玩家' }
    });
    actorId = actor.id;
    teamOwnerId = owner.id;
    userIds.push(actorId, teamOwnerId);
    const account = await prisma.gameAccount.create({
      data: {
        userId: teamOwnerId,
        platform: 'MOBILE',
        serverRegion: 'GLOBAL',
        gamerTag: `Renew-${suffix}`,
        isDefault: true
      }
    });
    teamAccountId = account.id;
    accountIds.push(account.id);
    const profile = await prisma.teamProfile.create({
      data: {
        ownerUserId: teamOwnerId,
        name: '续赛球队',
        shortName: '续赛',
        defaultGameAccountId: account.id
      }
    });
    teamProfileId = profile.id;
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
    await prisma.league.deleteMany({ where: { id: { in: leagueIds } } });
    await prisma.teamProfile.deleteMany({ where: { id: teamProfileId } });
    await prisma.gameAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function createLeague(name: string) {
    const league = await leagues.create(actorId, {
      name,
      shortName: name.slice(0, 12),
      description: '',
      logoUrl: null,
      defaultPlatform: 'MOBILE',
      defaultServerRegion: 'GLOBAL',
      defaultSuperCapacity: 23,
      defaultChampionCapacity: 18,
      defaultPromotionCount: 4
    }, randomUUID());
    leagueIds.push(league.id);
    return league;
  }

  function seasonInput(seasonNumber: number, overrides: Record<string, unknown> = {}) {
    const month = String(seasonNumber).padStart(2, '0');
    return {
      seasonNumber,
      displayName: `S${seasonNumber}`,
      registrationOpensAt: `2027-${month}-01T00:00:00.000Z`,
      registrationClosesAt: `2027-${month}-08T00:00:00.000Z`,
      startsAt: `2027-${month}-09T00:00:00.000Z`,
      endsAt: `2027-${month}-28T00:00:00.000Z`,
      ...overrides
    };
  }

  it('creates a first season from league defaults and a later season with overrides', async () => {
    const league = await createLeague('赛季顺序联赛');
    const first = await service.create(actorId, league.id, seasonInput(1), randomUUID());
    expect(first).toMatchObject({
      seasonNumber: 1,
      isFirstSeason: true,
      previousSeasonId: null,
      superCapacity: 23,
      championCapacity: 18,
      promotionCount: 4,
      status: 'DRAFT'
    });

    const second = await service.create(actorId, league.id, seasonInput(2, {
      superCapacity: 24,
      championCapacity: 16,
      promotionCount: 5
    }), randomUUID());
    expect(second).toMatchObject({
      seasonNumber: 2,
      isFirstSeason: false,
      previousSeasonId: first.id,
      superCapacity: 24,
      championCapacity: 16,
      promotionCount: 5
    });
  });

  it('rejects a sequence gap and invalid timeline', async () => {
    const league = await createLeague('校验联赛');
    await expect(service.create(actorId, league.id, seasonInput(2), randomUUID()))
      .rejects.toMatchObject({ code: 'SEASON_NUMBER_INVALID' });
    await expect(service.create(actorId, league.id, seasonInput(1, {
      registrationClosesAt: '2027-01-01T00:00:00.000Z'
    }), randomUUID())).rejects.toMatchObject({ code: 'SEASON_TIMELINE_INVALID' });
  });

  it('keeps season defaults stable after league defaults change', async () => {
    const league = await createLeague('规则快照联赛');
    const season = await service.create(actorId, league.id, seasonInput(1), randomUUID());
    await leagues.update(actorId, league.id, {
      defaultSuperCapacity: 30,
      defaultChampionCapacity: 12,
      expectedVersion: league.version
    }, randomUUID());

    await expect(service.getManaged(season.id)).resolves.toMatchObject({
      superCapacity: 23,
      championCapacity: 18
    });
  });

  it('lists draft seasons for managers while keeping them out of the public list', async () => {
    const league = await createLeague('草稿可发现联赛');
    const draft = await service.create(actorId, league.id, seasonInput(1), randomUUID());

    await expect(service.listPublic(league.id)).resolves.toEqual([]);
    await expect(service.listManaged(league.id)).resolves.toMatchObject([
      { id: draft.id, status: 'DRAFT', capabilities: { canManage: true } }
    ]);
  });

  it('updates a draft with a valid merged timeline and locks fields after opening', async () => {
    const league = await createLeague('编辑联赛');
    const season = await service.create(actorId, league.id, seasonInput(1), randomUUID());
    const updated = await service.update(actorId, season.id, {
      displayName: 'S1 新名称',
      championCapacity: 17,
      expectedVersion: season.version
    }, randomUUID());
    expect(updated).toMatchObject({ displayName: 'S1 新名称', championCapacity: 17, version: 2 });

    const opened = await service.transition(actorId, season.id, 'REGISTRATION_OPEN', {
      expectedVersion: updated.version
    }, randomUUID());
    await expect(service.update(actorId, season.id, {
      displayName: '不允许修改',
      expectedVersion: opened.version
    }, randomUUID())).rejects.toMatchObject({ code: 'SEASON_FIELDS_LOCKED' });
  });

  it('writes transition history, validates cancellation reason, and closes registration', async () => {
    const league = await createLeague('状态联赛');
    const season = await service.create(actorId, league.id, seasonInput(1), randomUUID());
    const opened = await service.transition(actorId, season.id, 'REGISTRATION_OPEN', {
      expectedVersion: season.version
    }, randomUUID());
    const closed = await service.transition(actorId, season.id, 'ALLOCATION_REVIEW', {
      expectedVersion: opened.version
    }, randomUUID());
    expect(closed.status).toBe('ALLOCATION_REVIEW');
    await expect(prisma.leagueSeasonStatusHistory.findMany({
      where: { seasonId: season.id },
      orderBy: { createdAt: 'asc' }
    })).resolves.toMatchObject([
      { fromStatus: null, toStatus: 'DRAFT' },
      { fromStatus: 'DRAFT', toStatus: 'REGISTRATION_OPEN' },
      { fromStatus: 'REGISTRATION_OPEN', toStatus: 'ALLOCATION_REVIEW' }
    ]);
    await expect(service.transition(actorId, season.id, 'CANCELLED', {
      expectedVersion: closed.version,
      reason: '   '
    }, randomUUID())).rejects.toMatchObject({ code: 'CANCELLATION_REASON_REQUIRED' });
  });

  it('creates one fresh renewal invitation and replays opening idempotently', async () => {
    const league = await createLeague('续赛联赛');
    const team = await prisma.leagueTeam.create({
      data: {
        leagueId: league.id,
        ownerUserId: teamOwnerId,
        teamNumber: 6,
        name: '续赛球队',
        shortName: '续赛',
        defaultGameAccountId: teamAccountId
      }
    });
    const first = await service.create(actorId, league.id, seasonInput(1), randomUUID());
    const previous = await prisma.seasonEntry.create({
      data: {
        seasonId: first.id,
        teamProfileId,
        leagueTeamId: team.id,
        ownerUserId: teamOwnerId,
        gameAccountId: teamAccountId,
        source: 'NEW_APPLICATION',
        status: 'APPROVED',
        teamNameSnapshot: '旧球队名',
        teamShortNameSnapshot: '旧名',
        teamNumberSnapshot: 6,
        gamePlatformSnapshot: 'MOBILE',
        serverRegionSnapshot: 'GLOBAL',
        gamerTagSnapshot: '旧玩家名'
      }
    });
    await prisma.leagueTeam.update({
      where: { id: team.id },
      data: { name: '续赛球队新名称' }
    });
    const second = await service.create(actorId, league.id, seasonInput(2), randomUUID());
    const key = randomUUID();
    const opened = await service.transition(actorId, second.id, 'REGISTRATION_OPEN', {
      expectedVersion: second.version
    }, key);
    const replay = await service.transition(actorId, second.id, 'REGISTRATION_OPEN', {
      expectedVersion: second.version
    }, key);
    expect(replay).toEqual(opened);

    const invitations = await prisma.seasonEntry.findMany({ where: { seasonId: second.id } });
    expect(invitations).toHaveLength(1);
    const invitation = invitations[0];
    expect(invitation).toBeDefined();
    expect(invitation).toMatchObject({
      source: 'RENEWAL',
      status: 'INVITED',
      previousSeasonEntryId: previous.id,
      teamNameSnapshot: '续赛球队新名称',
      gamerTagSnapshot: `Renew-${suffix}`
    });
    await expect(prisma.seasonEntryStatusHistory.count({
      where: { seasonEntryId: invitation!.id }
    })).resolves.toBe(1);
  });
});
