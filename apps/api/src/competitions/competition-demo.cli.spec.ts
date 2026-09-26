import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaService } from '../database/prisma.service.js';
import { CompetitionsService } from './competitions.service.js';
import { MutationReceiptService } from './mutation-receipt.service.js';
import { RegistrationsService, SystemCompetitionClock } from './registrations.service.js';
import { SchedulesService } from './schedules.service.js';
import { generateRoundRobin } from './domain/round-robin.js';
import { parseCompetitionDemoArgs, runCompetitionDemo } from './competition-demo.cli.js';

config({ path: '../../.env', quiet: true });

describe('competition demo CLI', () => {
  const prisma = new PrismaService();
  const receipts = new MutationReceiptService(prisma);
  const competitions = new CompetitionsService(prisma, receipts);
  const registrations = new RegistrationsService(prisma, receipts, new SystemCompetitionClock());
  const schedules = new SchedulesService(prisma, receipts, generateRoundRobin);
  const actorId = randomUUID();
  const namespace = `competition-demo-spec-${randomUUID()}`;
  let competitionId = '';

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({ data: { id: actorId, wechatOpenId: `${namespace}-admin`, displayName: 'Demo Spec Admin' } });
    const role = await prisma.role.findUniqueOrThrow({ where: { code: 'PLATFORM_ADMIN' } });
    await prisma.userRoleBinding.create({ data: { userId: actorId, roleId: role.id, scopeType: 'PLATFORM' } });
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({ where: { wechatOpenId: { startsWith: `test-openid-${namespace}-` } }, select: { id: true } });
    const userIds = users.map(({ id }) => id);
    if (competitionId) {
      await prisma.mutationReceipt.deleteMany({ where: { OR: [{ actorId }, { actorId: { in: userIds } }] } });
      await prisma.competitionMatch.deleteMany({ where: { stage: { competitionId } } });
      await prisma.competitionStage.deleteMany({ where: { competitionId } });
      await prisma.competitionParticipant.deleteMany({ where: { competitionId } });
      await prisma.competitionRegistrationStatusHistory.deleteMany({ where: { registration: { competitionId } } });
      await prisma.competitionRegistration.deleteMany({ where: { competitionId } });
      await prisma.userRoleBinding.deleteMany({ where: { scopeId: competitionId } });
      await prisma.competitionRuleVersion.deleteMany({ where: { competitionId } });
      await prisma.competition.deleteMany({ where: { id: competitionId } });
    }
    await prisma.gameAccount.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRoleBinding.deleteMany({ where: { userId: { in: [actorId, ...userIds] } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.user.delete({ where: { id: actorId } });
    await prisma.$disconnect();
  });

  it('requires a valid actor id', () => {
    expect(() => parseCompetitionDemoArgs([])).toThrow('COMPETITION_DEMO_ACTOR_REQUIRED');
    expect(() => parseCompetitionDemoArgs(['--actor', 'not-a-uuid'])).toThrow('COMPETITION_DEMO_ACTOR_REQUIRED');
    expect(parseCompetitionDemoArgs(['--actor', actorId])).toEqual({ actorId });
  });

  it('is disabled in production', async () => {
    await expect(runCompetitionDemo({ prisma, competitions, registrations, schedules }, { actorId, namespace, nodeEnv: 'production' }))
      .rejects.toThrow('COMPETITION_DEMO_DISABLED');
  });

  it('creates one reusable four-player, three-round demo', async () => {
    const dependencies = { prisma, competitions, registrations, schedules };
    const first = await runCompetitionDemo(dependencies, { actorId, namespace, nodeEnv: 'test' });
    competitionId = first.competitionId;
    const replay = await runCompetitionDemo(dependencies, { actorId, namespace, nodeEnv: 'test' });

    expect(replay.competitionId).toBe(first.competitionId);
    expect(replay).toMatchObject({ participantCount: 4, roundCount: 3, matchCount: 6 });
    expect(await prisma.user.count({ where: { wechatOpenId: { startsWith: `test-openid-${namespace}-` } } })).toBe(4);
    expect(await prisma.gameAccount.count({ where: { userId: { in: first.userIds } } })).toBe(4);
    const matches = await prisma.competitionMatch.findMany({ where: { stage: { competitionId } } });
    expect(new Set(matches.map(({ pairingKey }) => pairingKey)).size).toBe(6);
  });
});
