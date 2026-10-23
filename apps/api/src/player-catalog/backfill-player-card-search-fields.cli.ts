import { PrismaService } from '../database/prisma.service.js';
import { buildPlayerCardSearchFields } from './player-card-search-fields.js';

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Set DATABASE_URL explicitly for this backfill');
  const url = new URL(databaseUrl);
  console.log(`Target: ${url.hostname}:${url.port || '3306'}/${url.pathname.slice(1)}`);
  const chunkSize = Number(option('chunk-size') ?? 500);
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 2000) {
    throw new Error('--chunk-size must be between 1 and 2000');
  }
  const dryRun = process.argv.includes('--dry-run');
  let afterId = option('after-id') ?? '';
  let scanned = 0;
  let updated = 0;
  const prisma = new PrismaService();
  try {
    while (true) {
      const rows = await prisma.playerCardVersion.findMany({
        where: { id: { gt: afterId }, normalizedCardName: null },
        select: { id: true, cardName: true, packNameZh: true, packNameEn: true },
        orderBy: { id: 'asc' },
        take: chunkSize
      });
      if (!rows.length) break;
      scanned += rows.length;
      for (const row of rows) {
        const fields = buildPlayerCardSearchFields(row);
        if (!dryRun) {
          const result = await prisma.playerCardVersion.updateMany({
            where: { id: row.id, normalizedCardName: null },
            data: fields
          });
          updated += result.count;
        }
      }
      afterId = rows.at(-1)!.id;
      console.log(JSON.stringify({ scanned, updated, afterId }));
    }
    const remaining = await prisma.playerCardVersion.count({ where: { normalizedCardName: null } });
    const sample = await prisma.playerCardVersion.findMany({
      where: { normalizedCardName: { not: null } },
      select: { id: true, normalizedCardName: true, normalizedPackNameZh: true, normalizedPackNameEn: true },
      take: 3,
      orderBy: { id: 'asc' }
    });
    console.log(JSON.stringify({ dryRun, scanned, updated, remaining, sample }));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
