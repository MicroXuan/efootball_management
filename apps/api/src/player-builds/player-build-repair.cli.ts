import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from 'dotenv';
import { PrismaService } from '../database/prisma.service.js';
import { repairMissingPlayerBuilds, type PlayerBuildRepairMode } from './player-build-repair.js';

config({ path: '../../.env', quiet: true });

export function parsePlayerBuildRepairArgs(argv: string[]): { mode: PlayerBuildRepairMode } {
  const dryRun = argv.includes('--dry-run');
  const apply = argv.includes('--apply');
  if (dryRun === apply) throw new Error('USE_EXACTLY_ONE_OF_DRY_RUN_OR_APPLY');
  return { mode: apply ? 'apply' : 'dry-run' };
}

async function run(): Promise<void> {
  const { mode } = parsePlayerBuildRepairArgs(process.argv.slice(2));
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    process.stdout.write(`${JSON.stringify({ mode, ...await repairMissingPlayerBuilds(prisma, mode) }, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entryPath) void run().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
