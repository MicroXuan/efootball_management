import { config } from 'dotenv';
import { PrismaService } from '../src/database/prisma.service.js';
import { cleanupKnownTestArtifacts } from './helpers/test-data-cleanup.js';
import { assertIsolatedTestDatabaseUrl } from './assert-isolated-test-database.js';

const explicitDatabaseUrl = process.env.DATABASE_URL;
config({ path: '../../.env', quiet: true });
assertIsolatedTestDatabaseUrl(explicitDatabaseUrl);

const prisma = new PrismaService();
await prisma.$connect();
try {
  const result = await cleanupKnownTestArtifacts(prisma);
  if (Object.values(result).some((count) => count > 0)) {
    console.log(`[test-data-cleanup] ${JSON.stringify(result)}`);
  }
} finally {
  await prisma.$disconnect();
}
