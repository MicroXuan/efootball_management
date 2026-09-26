import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaService } from '../database/prisma.service.js';
import { MutationReceiptService } from './mutation-receipt.service.js';

config({ path: '../../.env', quiet: true });

describe('MutationReceiptService', () => {
  const prisma = new PrismaService();
  const service = new MutationReceiptService(prisma);
  const actorIds = [randomUUID(), randomUUID()];

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({
      data: actorIds.map((id, index) => ({
        id,
        wechatOpenId: `mutation-receipt-${id}`,
        displayName: `幂等测试员${index + 1}`
      }))
    });
  });

  afterEach(async () => {
    await prisma.mutationReceipt.deleteMany({ where: { actorId: { in: actorIds } } });
  });

  afterAll(async () => {
    await prisma.mutationReceipt.deleteMany({ where: { actorId: { in: actorIds } } });
    await prisma.user.deleteMany({ where: { id: { in: actorIds } } });
    await prisma.$disconnect();
  });

  it('runs a mutation once and replays its stored JSON response', async () => {
    const competitionId = randomUUID();
    let executions = 0;

    const first = await service.execute(
      actorIds[0]!,
      'competition.create',
      'create-1',
      async () => {
        executions += 1;
        return { id: competitionId, version: 1 };
      }
    );
    const second = await service.execute(
      actorIds[0]!,
      'competition.create',
      'create-1',
      async () => {
        executions += 1;
        return { id: randomUUID(), version: 1 };
      }
    );

    expect(second).toEqual(first);
    expect(executions).toBe(1);
    await expect(prisma.mutationReceipt.count({ where: { actorId: { in: actorIds } } })).resolves.toBe(1);
  });

  it('executes independently for a different actor or operation', async () => {
    let executions = 0;
    const work = async () => ({ execution: ++executions });

    await service.execute(actorIds[0]!, 'competition.create', 'shared-key', work);
    await service.execute(actorIds[1]!, 'competition.create', 'shared-key', work);
    await service.execute(actorIds[0]!, 'competition.update', 'shared-key', work);

    expect(executions).toBe(3);
    await expect(prisma.mutationReceipt.count({ where: { actorId: { in: actorIds } } })).resolves.toBe(3);
  });

  it('rolls back the receipt when the mutation callback fails', async () => {
    await expect(service.execute(
      actorIds[0]!,
      'competition.create',
      'failing-key',
      async () => {
        throw new Error('domain write failed');
      }
    )).rejects.toThrow('domain write failed');

    await expect(prisma.mutationReceipt.findFirst({
      where: { actorId: actorIds[0]!, key: 'failing-key' }
    })).resolves.toBeNull();
  });

  it.each(['', '   ', 'x'.repeat(129)])('rejects invalid key %p before work starts', async (key) => {
    let executions = 0;
    const work = async () => {
      executions += 1;
      return { ok: true };
    };

    await expect(service.execute(
      actorIds[0]!,
      'competition.create',
      key,
      work
    )).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_INVALID' },
      status: 400
    });

    expect(executions).toBe(0);
    await expect(prisma.mutationReceipt.count({ where: { actorId: { in: actorIds } } })).resolves.toBe(0);
  });
});
