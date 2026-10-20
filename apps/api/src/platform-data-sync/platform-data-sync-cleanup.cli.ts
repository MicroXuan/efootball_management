import { config } from 'dotenv';
import { PrismaService } from '../database/prisma.service.js';
import {
  clearPlatformSyncData,
  inspectPlatformSyncCleanup,
} from './platform-data-sync-cleanup.js';

config({ path: '../../.env', quiet: true });

async function main(): Promise<void> {
  const prisma = new PrismaService();
  await prisma.$connect();

  try {
    if (!process.argv.includes('--execute')) {
      const counts = await inspectPlatformSyncCleanup(prisma);
      console.log(JSON.stringify({ mode: 'dry-run', counts }, null, 2));
      console.log('未清理任何数据；确认后追加 --execute。');
      return;
    }

    const result = await clearPlatformSyncData(prisma);
    console.log(JSON.stringify({ mode: 'execute', ...result }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
