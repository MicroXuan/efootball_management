import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { z } from 'zod';
import { AppModule } from '../app.module.js';
import { PrismaService } from '../database/prisma.service.js';
import { CompetitionsService } from './competitions.service.js';
import { RegistrationsService } from './registrations.service.js';
import { SchedulesService } from './schedules.service.js';

const ActorIdSchema = z.uuid();
const DEFAULT_NAMESPACE = 'competition-demo';

export type CompetitionDemoArgs = { actorId: string };
export type CompetitionDemoOptions = CompetitionDemoArgs & { namespace?: string; nodeEnv?: string };
export type CompetitionDemoDependencies = {
  prisma: PrismaService;
  competitions: CompetitionsService;
  registrations: RegistrationsService;
  schedules: SchedulesService;
};
export type CompetitionDemoResult = {
  competitionId: string;
  userIds: string[];
  gameAccountIds: string[];
  participantCount: number;
  roundCount: number;
  matchCount: number;
  status: string;
};

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function parseCompetitionDemoArgs(argv: string[]): CompetitionDemoArgs {
  const actorId = option(argv, '--actor');
  const parsed = ActorIdSchema.safeParse(actorId);
  if (!parsed.success) throw new Error('COMPETITION_DEMO_ACTOR_REQUIRED');
  return { actorId: parsed.data };
}

export async function runCompetitionDemo(
  dependencies: CompetitionDemoDependencies,
  options: CompetitionDemoOptions
): Promise<CompetitionDemoResult> {
  if ((options.nodeEnv ?? process.env.NODE_ENV) === 'production') throw new Error('COMPETITION_DEMO_DISABLED');
  const { prisma, competitions, registrations, schedules } = dependencies;
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const actor = await prisma.user.findUnique({ where: { id: options.actorId } });
  const adminRole = await prisma.role.findUnique({ where: { code: 'PLATFORM_ADMIN' } });
  if (!actor || !adminRole) throw new Error('COMPETITION_DEMO_ACTOR_NOT_ADMIN');
  const adminBinding = await prisma.userRoleBinding.findFirst({
    where: {
      userId: actor.id, roleId: adminRole.id, scopeType: 'PLATFORM', scopeId: null,
      startsAt: { lte: new Date() }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
    }
  });
  if (!adminBinding) throw new Error('COMPETITION_DEMO_ACTOR_NOT_ADMIN');

  const users = [];
  const accounts = [];
  for (let index = 1; index <= 4; index += 1) {
    const user = await prisma.user.upsert({
      where: { wechatOpenId: `test-openid-${namespace}-${index}` },
      update: { displayName: `演示球员 ${index}`, region: '本地测试' },
      create: { wechatOpenId: `test-openid-${namespace}-${index}`, displayName: `演示球员 ${index}`, region: '本地测试' }
    });
    users.push(user);
    const existing = await prisma.gameAccount.findFirst({
      where: { userId: user.id, platform: 'MOBILE', serverRegion: 'GLOBAL' }, orderBy: { createdAt: 'asc' }
    });
    const account = existing
      ? await prisma.gameAccount.update({ where: { id: existing.id }, data: { gamerTag: `DEMO-${index}`, isDefault: true } })
      : await prisma.gameAccount.create({
          data: { userId: user.id, platform: 'MOBILE', serverRegion: 'GLOBAL', gamerTag: `DEMO-${index}`, isDefault: true }
        });
    accounts.push(account);
  }

  const now = Date.now();
  const competition = await competitions.create(options.actorId, {
    name: namespace === DEFAULT_NAMESPACE ? '[DEMO] 本地四人循环赛' : `[DEMO] ${namespace}`,
    description: '由本地演示命令创建，可用于验证报名、赛程、比分与积分榜闭环。',
    platform: 'MOBILE', serverRegion: 'GLOBAL', participantType: 'INDIVIDUAL', format: 'ROUND_ROBIN',
    participantLimit: 4,
    registrationOpensAt: new Date(now - 86_400_000).toISOString(),
    registrationClosesAt: new Date(now + 7 * 86_400_000).toISOString(),
    startsAt: new Date(now + 8 * 86_400_000).toISOString(),
    endsAt: new Date(now + 30 * 86_400_000).toISOString()
  }, `${namespace}:create`);
  const opened = await competitions.transition(options.actorId, competition.id, 'REGISTRATION_OPEN', {
    expectedVersion: competition.version
  }, `${namespace}:open`);

  for (let index = 0; index < users.length; index += 1) {
    const registration = await registrations.register(users[index]!.id, competition.id, {
      gameAccountId: accounts[index]!.id, acceptedRuleVersion: opened.activeRuleVersion
    }, `${namespace}:register:${index + 1}`);
    await registrations.review(options.actorId, competition.id, registration.id, {
      decision: 'APPROVE', expectedVersion: registration.version
    }, `${namespace}:approve:${index + 1}`);
  }

  const closed = await competitions.transition(options.actorId, competition.id, 'REGISTRATION_CLOSED', {
    expectedVersion: opened.version
  }, `${namespace}:close`);
  const draft = await schedules.generate(options.actorId, competition.id, `${namespace}:schedule:generate`);
  await schedules.publish(options.actorId, competition.id, {
    expectedCompetitionVersion: closed.version, expectedStageVersion: draft.version
  }, `${namespace}:schedule:publish`);

  const managerRole = await prisma.role.findUniqueOrThrow({ where: { code: 'EVENT_MANAGER' } });
  const managerBinding = await prisma.userRoleBinding.findFirst({
    where: { userId: users[0]!.id, roleId: managerRole.id, scopeType: 'COMPETITION', scopeId: competition.id }
  });
  if (!managerBinding) {
    await prisma.userRoleBinding.create({
      data: { userId: users[0]!.id, roleId: managerRole.id, scopeType: 'COMPETITION', scopeId: competition.id, grantedById: options.actorId }
    });
  }
  const scheduled = await competitions.getManaged(competition.id);
  await competitions.transition(options.actorId, competition.id, 'IN_PROGRESS', {
    expectedVersion: scheduled.version
  }, `${namespace}:start`);

  const [finalCompetition, preview, participantCount] = await Promise.all([
    competitions.getManaged(competition.id), schedules.preview(competition.id),
    prisma.competitionParticipant.count({ where: { competitionId: competition.id } })
  ]);
  return {
    competitionId: competition.id,
    userIds: users.map(({ id }) => id),
    gameAccountIds: accounts.map(({ id }) => id),
    participantCount,
    roundCount: preview.roundCount,
    matchCount: preview.matchCount,
    status: finalCompetition.status
  };
}

async function run(): Promise<void> {
  const args = parseCompetitionDemoArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const result = await runCompetitionDemo({
      prisma: app.get(PrismaService),
      competitions: app.get(CompetitionsService),
      registrations: app.get(RegistrationsService),
      schedules: app.get(SchedulesService)
    }, args);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await app.close();
  }
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entryPath) {
  void run().catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
  });
}
