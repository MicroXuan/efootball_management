import { config } from 'dotenv';
import { PrismaService } from '../src/database/prisma.service.js';
import { cleanupKnownTestArtifacts } from './helpers/test-data-cleanup.js';

config({ path: '../../.env', quiet: true });

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
