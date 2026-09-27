import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { RegistrationUsageAdapter } from '../competitions/registration-usage.adapter.js';
import { PrismaService } from '../database/prisma.service.js';
import { TeamProfilesService } from './team-profiles.service.js';

config({ path: '../../.env', quiet: true });

describe('TeamProfilesService', () => {
  const prisma = new PrismaService();
  const service = new TeamProfilesService(prisma);
  const usage = new RegistrationUsageAdapter(prisma);
  const suffix = randomUUID();
  const userIds: string[] = [];
  const accountIds: string[] = [];
  let ownerId: string;
  let strangerId: string;
  let ownerAccountId: string;
  let strangerAccountId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const owner = await prisma.user.create({
      data: { wechatOpenId: `team-owner-${suffix}`, displayName: '球队拥有者' }
    });
    const stranger = await prisma.user.create({
      data: { wechatOpenId: `team-stranger-${suffix}`, displayName: '其他玩家' }
    });
    ownerId = owner.id;
    strangerId = stranger.id;
    userIds.push(ownerId, strangerId);
    const ownerAccount = await prisma.gameAccount.create({
      data: {
        userId: ownerId,
        platform: 'MOBILE',
        serverRegion: 'GLOBAL',
        gamerTag: `Owner-${suffix}`,
        isDefault: true
      }
    });
    const strangerAccount = await prisma.gameAccount.create({
      data: {
        userId: strangerId,
        platform: 'MOBILE',
        serverRegion: 'GLOBAL',
        gamerTag: `Stranger-${suffix}`,
        isDefault: true
      }
    });
    ownerAccountId = ownerAccount.id;
    strangerAccountId = strangerAccount.id;
    accountIds.push(ownerAccountId, strangerAccountId);
  });

  afterAll(async () => {
    await prisma.teamProfile.deleteMany({ where: { ownerUserId: { in: userIds } } });
    await prisma.gameAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('creates, reads, and version-updates an owned team profile', async () => {
    await expect(service.get(ownerId)).resolves.toBeNull();

    const created = await service.create(ownerId, {
      name: '上海申花',
      shortName: '申花',
      logoUrl: null,
      defaultGameAccountId: ownerAccountId
    });
    expect(created).toMatchObject({
      ownerUserId: ownerId,
      name: '上海申花',
      shortName: '申花',
      defaultGameAccountId: ownerAccountId,
      version: 1
    });
    await expect(service.get(ownerId)).resolves.toMatchObject({ id: created.id });

    await expect(service.update(ownerId, {
      name: '上海申花 FC',
      expectedVersion: 1
    })).resolves.toMatchObject({ name: '上海申花 FC', version: 2 });
  });

  it('rejects a second team profile for the same owner', async () => {
    await expect(service.create(ownerId, {
      name: '第二支球队',
      shortName: '第二队',
      logoUrl: null,
      defaultGameAccountId: ownerAccountId
    })).rejects.toMatchObject({ code: 'TEAM_PROFILE_ALREADY_EXISTS' });
  });

  it('rejects a game account owned by another user', async () => {
    await expect(service.create(strangerId, {
      name: '错误球队',
      shortName: '错误',
      logoUrl: null,
      defaultGameAccountId: ownerAccountId
    })).rejects.toMatchObject({ code: 'GAME_ACCOUNT_NOT_OWNED' });

    const profile = await service.create(strangerId, {
      name: '合法球队',
      shortName: '合法',
      logoUrl: null,
      defaultGameAccountId: strangerAccountId
    });
    await expect(service.update(strangerId, {
      defaultGameAccountId: ownerAccountId,
      expectedVersion: profile.version
    })).rejects.toMatchObject({ code: 'GAME_ACCOUNT_NOT_OWNED' });
  });

  it('rejects a stale profile update', async () => {
    await expect(service.update(ownerId, {
      shortName: '过期修改',
      expectedVersion: 1
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('marks a game account selected by a team profile as in use', async () => {
    await expect(usage.hasActiveReferences(ownerAccountId)).resolves.toBe(true);
  });
});
