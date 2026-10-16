import { randomInt } from 'node:crypto';
import { Prisma } from '../../src/generated/prisma/client.js';

/** Allocate test-owned public numbers without claiming fixed shared-database identities. */
export async function createNumberedTestUser(
  prisma: Pick<Prisma.TransactionClient, 'user'>,
  data: Pick<Prisma.UserCreateInput, 'wechatOpenId' | 'displayName'>
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await prisma.user.create({
        data: { ...data, publicUserNo: String(randomInt(100000, 1000000)) }
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002'
        || !String(error.meta?.target).includes('public_user_no')) throw error;
    }
  }
  throw new Error('Unable to allocate an unused test public user number');
}
