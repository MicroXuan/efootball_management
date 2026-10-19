import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from 'dotenv';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import {
  executePlayerImportPublication,
  PLAYER_IMPORT_PUBLICATION_TIMEOUT_MS,
  preparePlayerImportPublication,
  type ExecutePlayerImportPublicationInput,
  type PreparedPlayerImportPublication
} from './player-import.publisher.js';

export type RollbackCheckOptions = {
  batchId: string;
  adminId: string;
  repeat: number;
  performanceTargetMs: number;
};

export type RollbackCheckResult = {
  attempt: number;
  elapsedMs: number;
  before: Readonly<Record<string, number>>;
  after: Readonly<Record<string, number>>;
};

type Counts = Readonly<Record<string, number>>;
type Transaction = Prisma.TransactionClient;
type RollbackCheckDependencies = {
  prepare: (prisma: PrismaService, batchId: string) => Promise<PreparedPlayerImportPublication>;
  execute: (
    tx: Transaction,
    input: ExecutePlayerImportPublicationInput
  ) => Promise<unknown>;
  capture: (prisma: PrismaService, batchId: string) => Promise<Counts>;
  assertBatchUnchanged: (prisma: PrismaService, batchId: string) => Promise<void>;
  now: () => number;
};

const ROLLBACK_PUBLICATION_CHECK = Symbol('ROLLBACK_PUBLICATION_CHECK');

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function requiredOption(argv: readonly string[], name: string): string {
  const value = option(argv, name);
  if (!value || value.startsWith('--')) throw new Error(`${name} is required`);
  return value;
}

export function parseRollbackCheckOptions(argv: readonly string[]): RollbackCheckOptions {
  const batchId = requiredOption(argv, '--batch-id');
  const adminId = requiredOption(argv, '--admin-id');
  const repeatText = requiredOption(argv, '--repeat');
  const repeat = Number(repeatText);
  if (!Number.isSafeInteger(repeat) || repeat <= 0) {
    throw new Error('--repeat must be a positive integer');
  }
  return { batchId, adminId, repeat, performanceTargetMs: 30_000 };
}

async function capturePublicationCounts(prisma: PrismaService, batchId: string): Promise<Counts> {
  const [
    releases,
    players,
    playerSources,
    packs,
    cards,
    attributes,
    skills,
    cardSkills,
    autoBuilds,
    bestCards,
    versions,
    audits
  ] = await Promise.all([
    prisma.catalogRelease.count({ where: { batchId } }),
    prisma.footballPlayer.count(),
    prisma.footballPlayerSource.count(),
    prisma.cardPack.count(),
    prisma.playerCard.count(),
    prisma.playerCardAttribute.count(),
    prisma.skill.count(),
    prisma.playerCardSkill.count(),
    prisma.playerCardAutoBuild.count(),
    prisma.footballPlayerBestCard.count(),
    prisma.playerCardVersion.count(),
    prisma.auditLog.count({
      where: {
        action: 'PUBLISH_PLAYER_CARD_IMPORT_BATCH',
        resourceType: 'ImportBatch',
        resourceId: batchId
      }
    })
  ]);
  return {
    releases,
    players,
    playerSources,
    packs,
    cards,
    attributes,
    skills,
    cardSkills,
    autoBuilds,
    bestCards,
    versions,
    audits
  };
}

async function assertBatchUnchanged(prisma: PrismaService, batchId: string): Promise<void> {
  const batch = await prisma.importBatch.findUnique({
    where: { id: batchId },
    select: { status: true, publishedAt: true, release: { select: { id: true } } }
  });
  if (!batch) throw new Error(`Batch ${batchId} no longer exists`);
  if (batch.status !== 'READY' || batch.publishedAt !== null || batch.release !== null) {
    throw new Error(`Batch ${batchId} changed during rollback acceptance`);
  }
}

const defaultDependencies: RollbackCheckDependencies = {
  prepare: preparePlayerImportPublication,
  execute: executePlayerImportPublication,
  capture: capturePublicationCounts,
  assertBatchUnchanged,
  now: () => performance.now()
};

function differingCountKeys(before: Counts, after: Counts): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => before[key] !== after[key]);
}

export async function runPublicationRollbackChecks(
  prisma: PrismaService,
  options: RollbackCheckOptions,
  dependencies: RollbackCheckDependencies = defaultDependencies
): Promise<readonly RollbackCheckResult[]> {
  if (!Number.isSafeInteger(options.repeat) || options.repeat <= 0) {
    throw new Error('repeat must be a positive integer');
  }
  if (!(options.performanceTargetMs > 0)) throw new Error('performanceTargetMs must be positive');

  const audit = new AuditLogService(prisma);
  const results: RollbackCheckResult[] = [];
  for (let attempt = 1; attempt <= options.repeat; attempt += 1) {
    const before = await dependencies.capture(prisma, options.batchId);
    const prepared = await dependencies.prepare(prisma, options.batchId);
    const startedAt = dependencies.now();
    try {
      await prisma.$transaction(async (tx) => {
        await dependencies.execute(tx, {
          actorId: options.adminId,
          batchId: options.batchId,
          platformAdmin: true,
          preparedRecords: prepared.preparedRecords,
          snapshotKey: prepared.snapshotKey,
          audit
        });
        throw ROLLBACK_PUBLICATION_CHECK;
      }, { timeout: PLAYER_IMPORT_PUBLICATION_TIMEOUT_MS });
      throw new Error('Rollback acceptance transaction committed unexpectedly');
    } catch (error) {
      if (error !== ROLLBACK_PUBLICATION_CHECK) throw error;
    }
    const elapsedMs = dependencies.now() - startedAt;
    if (elapsedMs >= options.performanceTargetMs) {
      throw new Error(
        `Rollback acceptance exceeded ${options.performanceTargetMs}ms: ${Math.round(elapsedMs)}ms`
      );
    }

    const after = await dependencies.capture(prisma, options.batchId);
    const changedKeys = differingCountKeys(before, after);
    if (changedKeys.length > 0) {
      throw new Error(`Rollback acceptance changed table counts: ${changedKeys.join(', ')}`);
    }
    await dependencies.assertBatchUnchanged(prisma, options.batchId);
    results.push({ attempt, elapsedMs, before, after });
  }
  return results;
}

async function run(): Promise<void> {
  config({ path: '../../.env', quiet: true });
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const results = await runPublicationRollbackChecks(
      prisma,
      parseRollbackCheckOptions(process.argv.slice(2))
    );
    process.stdout.write(`${JSON.stringify({ ok: true, results }, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entryPath) {
  void run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
