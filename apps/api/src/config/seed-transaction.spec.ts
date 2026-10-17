import { SEED_TRANSACTION_OPTIONS } from '../../prisma/seed.config.js';

describe('seed transaction configuration', () => {
  it('allows enough time for remote staging database round trips', () => {
    expect(SEED_TRANSACTION_OPTIONS).toEqual({ maxWait: 10_000, timeout: 60_000 });
  });
});
