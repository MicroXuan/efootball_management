import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaService } from '../database/prisma.service.js';

export type LeagueTeamBackfillArgs = { mode: 'dry-run' | 'apply'; productionConfirmed: boolean };
type TeamRow = { id: string; leagueId: string; ownerUserId: string; teamNumber: number | null; status: string };
export type LeagueTeamMigrationReport = {
  mode: 'dry-run' | 'apply';
  createdTeams: number;
  unresolvedNumbers: number;
  linkedSeasonEntries: number;
  legacyProfiles: number;
  invariantViolations: string[];
};

export function parseLeagueTeamBackfillArgs(argv: string[], nodeEnv = process.env.NODE_ENV): LeagueTeamBackfillArgs {
  const apply = argv.includes('--apply');
  const dryRun = argv.includes('--dry-run');
  if (apply === dryRun) throw new Error('USE_EXACTLY_ONE_OF_DRY_RUN_OR_APPLY');
  const productionConfirmed = argv.includes('--confirm-production');
  if (apply && nodeEnv === 'production' && !productionConfirmed) throw new Error('PRODUCTION_CONFIRMATION_REQUIRED');
  return { mode: apply ? 'apply' : 'dry-run', productionConfirmed };
}

export function analyzeLeagueTeamRows(
  rows: readonly TeamRow[],
  linkedSeasonEntries: number,
  legacyProfiles: number
): Omit<LeagueTeamMigrationReport, 'mode' | 'createdTeams'> {
  const invariantViolations: string[] = [];
  const owners = new Set<string>();
  const numbers = new Set<string>();
  for (const row of rows) {
    const ownerKey = `${row.leagueId}:${row.ownerUserId}`;
    if (owners.has(ownerKey)) invariantViolations.push(`duplicate owner ${row.ownerUserId} in league ${row.leagueId}`);
    owners.add(ownerKey);
    if (row.teamNumber !== null) {
      const numberKey = `${row.leagueId}:${row.teamNumber}`;
      if (numbers.has(numberKey)) invariantViolations.push(`duplicate team number ${row.teamNumber} in league ${row.leagueId}`);
      numbers.add(numberKey);
    }
  }
  return {
    unresolvedNumbers: rows.filter((row) => row.teamNumber === null || row.status === 'NEEDS_NUMBER').length,
    linkedSeasonEntries,
    legacyProfiles,
    invariantViolations
  };
}

export async function inspectLeagueTeamMigration(prisma: PrismaService, mode: 'dry-run' | 'apply'): Promise<LeagueTeamMigrationReport> {
  const [rows, linkedSeasonEntries, legacyProfiles] = await Promise.all([
    prisma.leagueTeam.findMany({ select: { id: true, leagueId: true, ownerUserId: true, teamNumber: true, status: true } }),
    prisma.seasonEntry.count(),
    prisma.teamProfile.count()
  ]);
  const analysis = analyzeLeagueTeamRows(rows, linkedSeasonEntries, legacyProfiles);
  if (mode === 'apply' && (analysis.unresolvedNumbers > 0 || analysis.invariantViolations.length > 0)) {
    throw new Error(`LEAGUE_TEAM_MIGRATION_UNRESOLVED:${JSON.stringify(analysis)}`);
  }
  return { mode, createdTeams: 0, ...analysis };
}

async function run() {
  const args = parseLeagueTeamBackfillArgs(process.argv.slice(2));
  const prisma = new PrismaService();
  await prisma.$connect();
  try { process.stdout.write(`${JSON.stringify(await inspectLeagueTeamMigration(prisma, args.mode), null, 2)}\n`); }
  finally { await prisma.$disconnect(); }
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entryPath) void run().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
