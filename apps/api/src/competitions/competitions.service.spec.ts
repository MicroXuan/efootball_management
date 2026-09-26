import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import type { ParsedCreateCompetitionRequest } from '@efm/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { CompetitionsService } from './competitions.service.js';
import { MutationReceiptService } from './mutation-receipt.service.js';

config({ path: '../../.env', quiet: true });

describe('CompetitionsService', () => {
  const prisma = new PrismaService();
  const service = new CompetitionsService(prisma, new MutationReceiptService(prisma));
  const userIds: [string, string] = [randomUUID(), randomUUID()];
  const createdCompetitionIds: string[] = [];
  const validCreate: ParsedCreateCompetitionRequest = {
    name: '秋季个人联赛',
    description: '4 人测试联赛',
    platform: 'MOBILE',
    serverRegion: 'GLOBAL',
    participantType: 'INDIVIDUAL',
    format: 'ROUND_ROBIN',
    registrationOpensAt: '2026-10-01T00:00:00.000Z',
    registrationClosesAt: '2026-10-08T00:00:00.000Z',
    startsAt: '2026-10-09T00:00:00.000Z',
    endsAt: '2026-10-31T00:00:00.000Z',
    participantLimit: 16
  };

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({
      data: userIds.map((id, index) => ({
        id,
        wechatOpenId: `competition-service-${id}`,
        displayName: `赛事测试员${index + 1}`
      }))
    });
    await prisma.role.upsert({
      where: { code: 'EVENT_MANAGER' },
      update: {},
      create: { code: 'EVENT_MANAGER', name: '赛事管理员' }
    });
  });

  afterEach(async () => {
    await prisma.mutationReceipt.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.userRoleBinding.deleteMany({ where: { scopeId: { in: createdCompetitionIds } } });
    await prisma.competitionRuleVersion.deleteMany({ where: { competitionId: { in: createdCompetitionIds } } });
    await prisma.competition.deleteMany({ where: { id: { in: createdCompetitionIds } } });
    createdCompetitionIds.splice(0);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function create(actorId: string = userIds[0], key: string = randomUUID()) {
    const competition = await service.create(actorId, validCreate, key);
    if (!createdCompetitionIds.includes(competition.id)) createdCompetitionIds.push(competition.id);
    return competition;
  }

  it('creates a draft, initial rules, scoped manager binding, and replays the response', async () => {
    const first = await create(userIds[0]!, 'create-once');
    const replay = await service.create(userIds[0]!, { ...validCreate, name: '不会重复创建' }, 'create-once');

    expect(first).toMatchObject({ status: 'DRAFT', version: 1, activeRuleVersion: 1 });
    expect(replay).toEqual(first);
    await expect(prisma.competition.count({ where: { id: first.id } })).resolves.toBe(1);
    await expect(prisma.competitionRuleVersion.count({ where: { competitionId: first.id } })).resolves.toBe(1);
    await expect(prisma.userRoleBinding.findFirst({
      where: { userId: userIds[0], scopeType: 'COMPETITION', scopeId: first.id },
      include: { role: true }
    })).resolves.toMatchObject({ role: { code: 'EVENT_MANAGER' } });
  });

  it('versions rules, binds them on open, and locks core fields', async () => {
    const created = await create();
    const withRules = await service.updateRules(userIds[0]!, created.id, {
      winPoints: 4,
      drawPoints: 2,
      lossPoints: 0,
      tieBreakers: ['TOTAL_POINTS', 'TOTAL_GOAL_DIFFERENCE'],
      expectedVersion: 1
    }, randomUUID());
    const opened = await service.transition(
      userIds[0]!,
      created.id,
      'REGISTRATION_OPEN',
      { expectedVersion: withRules.version },
      randomUUID()
    );

    expect(withRules).toMatchObject({ activeRuleVersion: 2, version: 2 });
    expect(opened).toMatchObject({ status: 'REGISTRATION_OPEN', version: 3 });
    await expect(prisma.competitionRuleVersion.count({ where: { competitionId: created.id } })).resolves.toBe(2);
    await expect(prisma.competition.findUniqueOrThrow({ where: { id: created.id } }))
      .resolves.toMatchObject({ boundRuleVersion: 2 });
    await expect(service.update(userIds[0]!, created.id, {
      platform: 'STEAM', expectedVersion: 3
    }, randomUUID())).rejects.toMatchObject({
      response: { code: 'COMPETITION_CORE_FIELDS_LOCKED' }
    });
  });

  it('locks rule mutation after the competition starts', async () => {
    const created = await create();
    await prisma.competition.update({ where: { id: created.id }, data: { status: 'IN_PROGRESS' } });

    await expect(service.updateRules(userIds[0]!, created.id, {
      winPoints: 3,
      drawPoints: 1,
      lossPoints: 0,
      tieBreakers: ['TOTAL_POINTS'],
      expectedVersion: 1
    }, randomUUID())).rejects.toMatchObject({ response: { code: 'COMPETITION_RULES_LOCKED' } });
  });

  it('excludes drafts and exposes registration-open competitions publicly', async () => {
    await create(userIds[0]!, randomUUID());
    const visible = await create(userIds[1]!, randomUUID());
    await service.transition(userIds[1]!, visible.id, 'REGISTRATION_OPEN', { expectedVersion: 1 }, randomUUID());

    const page = await service.listPublic({ limit: 100 });
    expect(page.items.some(({ id }) => id === visible.id)).toBe(true);
    expect(page.items.some(({ id }) => createdCompetitionIds[0] === id)).toBe(false);
  });
});
