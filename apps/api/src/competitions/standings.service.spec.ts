import { config } from 'dotenv';
import { PrismaService } from '../database/prisma.service.js';
import { StandingsService } from './standings.service.js';

config({ path: '../../.env', quiet: true });

describe('StandingsService', () => {
  const prisma = new PrismaService();
  const service = new StandingsService(prisma);

  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());

  it('returns an empty version-zero public snapshot before any official result', async () => {
    await expect(service.getLatestPublic('00000000-0000-4000-8000-000000000000')).resolves.toEqual({
      competitionId: '00000000-0000-4000-8000-000000000000',
      version: 0,
      ruleVersion: 1,
      triggeringResultVersionId: null,
      generatedAt: null,
      rows: []
    });
  });
});
