import jestConfig from '../../jest.config.js';
import { PRISMA_TRANSACTION_OPTIONS, prismaClientOptions } from './prisma.service.js';

describe('Prisma transaction defaults', () => {
  it('allows slow lock acquisition and long-running interactive work', () => {
    expect(PRISMA_TRANSACTION_OPTIONS).toEqual({ maxWait: 10_000, timeout: 60_000 });
    expect(prismaClientOptions('mysql://user:password@localhost:3306/database').transactionOptions)
      .toBe(PRISMA_TRANSACTION_OPTIONS);
  });

  it('gives database-backed API tests the same execution window', () => {
    expect(jestConfig.testTimeout).toBe(60_000);
  });
});
