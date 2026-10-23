import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { pesdataValueChecksum } from './pesdata-mapper.js';
import { inspectScanPage } from './player-catalog-reconciliation.rules.js';
import type { PesdataPlayerSummary } from './pesdata.schemas.js';

type ScanSummary = Pick<PesdataPlayerSummary, 'playerId'> & Partial<PesdataPlayerSummary>;
type Verification = { trusted: true; sourceTotal: number } | { trusted: false; reason: string; sourceTotal?: number };

@Injectable()
export class PlayerCatalogScanRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async recordPage(
    runId: string,
    pass: 1 | 2,
    offset: number,
    pageLimit: number,
    reportedTotal: number,
    summaries: ScanSummary[]
  ): Promise<void> {
    const ids = summaries.map(({ playerId }) => String(playerId).trim());
    const error = inspectScanPage({ offset, limit: pageLimit, count: reportedTotal, ids });
    if (error) throw new Error(error);
    const idChecksum = createHash('sha256').update(JSON.stringify(ids)).digest('hex');
    const summaryChecksums = summaries.map(pesdataValueChecksum);
    try {
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.playerCatalogScanPage.findUnique({
          where: { runId_pass_offset: { runId, pass, offset } }
        });
        if (existing) {
          if (existing.idChecksum === idChecksum && existing.reportedTotal === reportedTotal
            && existing.returnedCount === ids.length && existing.pageLimit === pageLimit) {
            const saved = await tx.playerCatalogScanEntry.findMany({
              where: { runId, pass, externalId: { in: ids } },
              select: { externalId: true, summaryChecksum: true }
            });
            const byId = new Map(saved.map(({ externalId, summaryChecksum }) => [externalId, summaryChecksum]));
            if (ids.every((id, index) => byId.get(id) === summaryChecksums[index])) return;
          }
          throw new Error('PAGE_CHANGED_ON_RETRY');
        }
        const first = await tx.playerCatalogScanPage.findFirst({ where: { runId, pass }, select: { reportedTotal: true } });
        if (first && first.reportedTotal !== reportedTotal) throw new Error('TOTAL_CHANGED');
        await tx.playerCatalogScanPage.create({ data: {
          runId, pass, offset, pageLimit, reportedTotal, returnedCount: ids.length, idChecksum
        } });
        await tx.playerCatalogScanEntry.createMany({ data: summaries.map((summary, index) => ({
          runId, pass, externalId: ids[index]!, summaryChecksum: summaryChecksums[index]!,
          displayName: (summary.playerName_cn ?? summary.playerName ?? String(summary.playerId)).slice(0, 255)
        })) });
      }, { timeout: 15_000 });
    } catch (caught) {
      if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === 'P2002') {
        throw new Error('DUPLICATE_ID', { cause: caught });
      }
      throw caught;
    }
  }

  async verify(runId: string): Promise<Verification> {
    const passes: Array<{ total: number }> = [];
    for (const pass of [1, 2] as const) {
      const pages = await this.prisma.playerCatalogScanPage.findMany({
        where: { runId, pass }, orderBy: { offset: 'asc' }
      });
      if (!pages.length) return { trusted: false, reason: 'PASS_EMPTY' };
      const total = pages[0]!.reportedTotal;
      let nextOffset = 0;
      for (const page of pages) {
        if (page.reportedTotal !== total) return { trusted: false, reason: 'TOTAL_CHANGED' };
        if (page.offset !== nextOffset) return { trusted: false, reason: 'PAGE_GAP' };
        if (page.returnedCount !== Math.min(page.pageLimit, total - page.offset)) {
          return { trusted: false, reason: 'INCOMPLETE_PAGE' };
        }
        nextOffset += page.returnedCount;
      }
      if (nextOffset !== total) return { trusted: false, reason: 'PAGE_GAP' };
      const unique = await this.prisma.playerCatalogScanEntry.count({ where: { runId, pass } });
      if (unique !== total) return { trusted: false, reason: 'ID_COUNT_MISMATCH' };
      passes.push({ total });
    }
    if (passes[0]!.total !== passes[1]!.total) return { trusted: false, reason: 'PASS_TOTAL_MISMATCH' };
    const rows = await this.prisma.$queryRaw<Array<{ missing: bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS missing FROM player_catalog_scan_entries first_pass
      LEFT JOIN player_catalog_scan_entries second_pass
        ON second_pass.run_id = first_pass.run_id AND second_pass.pass = 2
        AND second_pass.external_id = first_pass.external_id
      WHERE first_pass.run_id = ${runId} AND first_pass.pass = 1
        AND second_pass.external_id IS NULL
    `);
    if (Number(rows[0]?.missing ?? 0) !== 0) return { trusted: false, reason: 'PASS_SET_MISMATCH' };
    return { trusted: true, sourceTotal: passes[0]!.total };
  }
}
