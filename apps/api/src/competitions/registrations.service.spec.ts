import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaService } from '../database/prisma.service.js';
import { CompetitionsService } from './competitions.service.js';
import { MutationReceiptService } from './mutation-receipt.service.js';
import { RegistrationsService, type CompetitionClock } from './registrations.service.js';

config({ path: '../../.env', quiet: true });

describe('RegistrationsService', () => {
  const prisma = new PrismaService();
  const now = { value: new Date('2026-11-01T06:30:00.000Z') };
  const clock: CompetitionClock = { now: () => new Date(now.value) };
  const service = new RegistrationsService(prisma, new MutationReceiptService(prisma), clock);
  const lifecycle = new CompetitionsService(prisma, new MutationReceiptService(prisma));
  const users: [string, string, string] = [randomUUID(), randomUUID(), randomUUID()];
  const competitionIds: string[] = [];
  const accountIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({ data: users.map((id, index) => ({
      id, wechatOpenId: `registration-${id}`, displayName: `报名玩家${index + 1}`
    })) });
    for (const [index, userId] of users.entries()) {
      const account = await prisma.gameAccount.create({
        data: { userId, platform: 'MOBILE', serverRegion: 'GLOBAL', gamerTag: `Player${index + 1}` }
      });
      accountIds.push(account.id);
    }
  });

  afterEach(async () => {
    await prisma.mutationReceipt.deleteMany({ where: { actorId: { in: users } } });
    await prisma.standingsRow.deleteMany({ where: { participant: { competitionId: { in: competitionIds } } } });
    await prisma.competitionParticipant.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.competitionRegistrationStatusHistory.deleteMany({
      where: { registration: { competitionId: { in: competitionIds } } }
    });
    await prisma.competitionRegistration.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.competitionRuleVersion.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.competition.deleteMany({ where: { id: { in: competitionIds } } });
    competitionIds.splice(0);
    now.value = new Date('2026-11-01T06:30:00.000Z');
  });

  afterAll(async () => {
    await prisma.gameAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  async function competition(overrides: Record<string, unknown> = {}) {
    const created = await prisma.competition.create({
      data: {
        name: 'DST 个人联赛',
        description: '',
        platform: 'MOBILE',
        serverRegion: 'GLOBAL',
        participantType: 'INDIVIDUAL',
        format: 'ROUND_ROBIN',
        status: 'REGISTRATION_OPEN',
        registrationOpensAt: new Date('2026-11-01T05:30:00.000Z'),
        registrationClosesAt: new Date('2026-11-01T07:30:00.000Z'),
        startsAt: new Date('2026-11-02T00:00:00.000Z'),
        endsAt: new Date('2026-11-30T00:00:00.000Z'),
        participantLimit: 8,
        createdById: users[2],
        boundRuleVersion: 1,
        ...overrides
      }
    });
    await prisma.competitionRuleVersion.create({
      data: {
        competitionId: created.id,
        version: 1,
        winPoints: 3,
        drawPoints: 1,
        lossPoints: 0,
        tieBreakers: ['TOTAL_POINTS'],
        createdById: users[2]
      }
    });
    competitionIds.push(created.id);
    return created;
  }

  it('registers an eligible owned account and appends durable history', async () => {
    const event = await competition();
    const registered = await service.register(users[0], event.id, {
      gameAccountId: accountIds[0]!, acceptedRuleVersion: 1
    }, 'register-1');
    const replay = await service.register(users[0], event.id, {
      gameAccountId: accountIds[0]!, acceptedRuleVersion: 1
    }, 'register-2');

    expect(replay.id).toBe(registered.id);
    await expect(prisma.competitionRegistrationStatusHistory.count({
      where: { registrationId: registered.id }
    })).resolves.toBe(1);
  });

  it('rejects foreign, platform-mismatched, full, and out-of-window registration', async () => {
    const event = await competition({ participantLimit: 1 });
    now.value = new Date('2026-11-01T05:29:59.999Z');
    await expect(service.register(users[0], event.id, {
      gameAccountId: accountIds[0]!, acceptedRuleVersion: 1
    }, randomUUID())).rejects.toMatchObject({ response: { code: 'REGISTRATION_CLOSED' } });
    now.value = new Date('2026-11-01T06:30:00.000Z');
    await expect(service.register(users[0], event.id, {
      gameAccountId: accountIds[1]!, acceptedRuleVersion: 1
    }, randomUUID())).rejects.toMatchObject({ response: { code: 'GAME_ACCOUNT_NOT_FOUND' } });
    await prisma.gameAccount.update({ where: { id: accountIds[0]! }, data: { platform: 'STEAM' } });
    await expect(service.register(users[0], event.id, {
      gameAccountId: accountIds[0]!, acceptedRuleVersion: 1
    }, randomUUID())).rejects.toMatchObject({ response: { code: 'GAME_ACCOUNT_INELIGIBLE' } });
    await prisma.gameAccount.update({ where: { id: accountIds[0]! }, data: { platform: 'MOBILE' } });
    await service.register(users[0], event.id, { gameAccountId: accountIds[0]!, acceptedRuleVersion: 1 }, randomUUID());
    await expect(service.register(users[1], event.id, {
      gameAccountId: accountIds[1]!, acceptedRuleVersion: 1
    }, randomUUID())).rejects.toMatchObject({ response: { code: 'REGISTRATION_FULL' } });
    now.value = new Date('2026-11-01T07:30:00.001Z');
    await expect(service.register(users[1], event.id, {
      gameAccountId: accountIds[1]!, acceptedRuleVersion: 1
    }, randomUUID())).rejects.toMatchObject({ response: { code: 'REGISTRATION_CLOSED' } });
  });

  it('preserves reject, withdraw, and resubmit history', async () => {
    const event = await competition();
    const registered = await service.register(users[0], event.id, {
      gameAccountId: accountIds[0]!, acceptedRuleVersion: 1
    }, randomUUID());
    await service.review(users[2], event.id, registered.id, {
      decision: 'REJECT', reason: '资料不完整', expectedVersion: 1
    }, randomUUID());
    const resubmitted = await service.register(users[0], event.id, {
      gameAccountId: accountIds[0]!, acceptedRuleVersion: 1
    }, randomUUID());
    await service.withdraw(users[0], event.id, { expectedVersion: resubmitted.version }, randomUUID());

    const history = await prisma.competitionRegistrationStatusHistory.findMany({
      where: { registrationId: registered.id }, orderBy: { createdAt: 'asc' }
    });
    expect(history.map(({ toStatus }) => toStatus)).toEqual(['PENDING', 'REJECTED', 'PENDING', 'WITHDRAWN']);
  });

  it('admits one participant when approval is replayed', async () => {
    const event = await competition();
    const registered = await service.register(users[0], event.id, {
      gameAccountId: accountIds[0]!, acceptedRuleVersion: 1
    }, randomUUID());
    const input = { decision: 'APPROVE' as const, expectedVersion: 1 };
    const first = await service.review(users[2], event.id, registered.id, input, 'approve-once');
    const replay = await service.review(users[2], event.id, registered.id, input, 'approve-once');

    expect(replay).toEqual(first);
    await expect(prisma.competitionParticipant.count({ where: { competitionId: event.id } })).resolves.toBe(1);
  });

  it('keeps one durable application under concurrent registration', async () => {
    const event = await competition();
    const input = { gameAccountId: accountIds[0]!, acceptedRuleVersion: 1 };
    const outcomes = await Promise.allSettled([
      service.register(users[0], event.id, input, randomUUID()),
      service.register(users[0], event.id, input, randomUUID())
    ]);

    expect(outcomes.some(({ status }) => status === 'fulfilled')).toBe(true);
    await expect(prisma.competitionRegistration.count({
      where: { competitionId: event.id, applicantId: users[0] }
    })).resolves.toBe(1);
  });

  it('serializes registration with closing so no registration commits after closure', async () => {
    const event = await competition();
    const input = { gameAccountId: accountIds[0]!, acceptedRuleVersion: 1 };
    const outcomes = await Promise.allSettled([
      service.register(users[0], event.id, input, randomUUID()),
      lifecycle.transition(users[2], event.id, 'REGISTRATION_CLOSED', { expectedVersion: 1 }, randomUUID())
    ]);
    const closed = await prisma.competition.findUniqueOrThrow({ where: { id: event.id } });
    const registration = await prisma.competitionRegistration.findUnique({
      where: { competitionId_applicantId: { competitionId: event.id, applicantId: users[0] } }
    });

    expect(outcomes[1]?.status).toBe('fulfilled');
    expect(closed.status).toBe('REGISTRATION_CLOSED');
    if (outcomes[0]?.status === 'rejected') {
      expect(outcomes[0].reason).toMatchObject({ response: { code: 'REGISTRATION_CLOSED' } });
      expect(registration).toBeNull();
    } else {
      expect(registration).not.toBeNull();
      expect(registration!.createdAt.getTime()).toBeLessThanOrEqual(closed.updatedAt.getTime());
    }
  });
});
