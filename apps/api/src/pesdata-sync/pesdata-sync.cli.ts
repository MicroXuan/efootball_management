import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { z } from 'zod';
import { AppModule } from '../app.module.js';
import { PesdataSyncService } from './pesdata-sync.service.js';
import type { PesdataSyncMode } from './pesdata-sync.types.js';
import { PesdataTeamSyncService, type TeamSyncMode } from './pesdata-team-sync.service.js';

type StartArgs = {
  command: 'start';
  mode: PesdataSyncMode;
  actorId: string;
  limit?: number;
  dryRun: boolean;
};

type ResumeArgs = {
  command: 'resume';
  runId: string;
  actorId: string;
};

type TeamStartArgs = { resource: 'teams'; command: 'start'; mode: TeamSyncMode; actorId: string; limit?: number };
type TeamResumeArgs = { resource: 'teams'; command: 'resume'; runId: string; actorId: string };
export type PesdataSyncArgs = StartArgs | ResumeArgs | TeamStartArgs | TeamResumeArgs;

export class PesdataCliError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PesdataCliError';
  }
}

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function requiredActor(argv: string[]): string {
  const actorId = option(argv, '--actor');
  if (!actorId || actorId.startsWith('--')) throw new PesdataCliError('PESDATA_ACTOR_REQUIRED');
  if (!z.uuid().safeParse(actorId).success) throw new PesdataCliError('PESDATA_ACTOR_INVALID');
  return actorId;
}

export function parsePesdataSyncArgs(argv: string[]): PesdataSyncArgs {
  const normalizedArguments = argv[0] === '--' ? argv.slice(1) : argv;
  if (normalizedArguments[0] === 'teams') {
    const teamArguments = normalizedArguments.slice(1);
    const [teamMode, teamTarget] = teamArguments;
    const actorId = requiredActor(teamArguments);
    if (teamMode === 'resume') {
      if (!teamTarget || !z.uuid().safeParse(teamTarget).success) throw new PesdataCliError('PESDATA_TEAM_RUN_INVALID');
      return { resource: 'teams', command: 'resume', runId: teamTarget, actorId };
    }
    if (teamMode !== 'sample' && teamMode !== 'full' && teamMode !== 'incremental') {
      throw new PesdataCliError('PESDATA_TEAM_MODE_INVALID');
    }
    const limitValue = option(teamArguments, '--limit');
    if (limitValue !== undefined && teamMode !== 'sample') throw new PesdataCliError('PESDATA_TEAM_LIMIT_UNSUPPORTED');
    const limit = limitValue === undefined ? undefined : Number(limitValue);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 5_000)) {
      throw new PesdataCliError('PESDATA_TEAM_LIMIT_INVALID');
    }
    return { resource: 'teams', command: 'start', mode: teamMode, actorId, ...(limit === undefined ? {} : { limit }) };
  }
  const [mode, target] = normalizedArguments;
  const actorId = requiredActor(normalizedArguments);
  const dryRun = normalizedArguments.includes('--dry-run');

  if (mode === 'resume') {
    if (dryRun) throw new PesdataCliError('PESDATA_DRY_RUN_UNSUPPORTED');
    if (!target || !z.uuid().safeParse(target).success) throw new PesdataCliError('PESDATA_RUN_INVALID');
    return { command: 'resume', runId: target, actorId };
  }

  if (mode !== 'sample' && mode !== 'full' && mode !== 'incremental') {
    throw new PesdataCliError('PESDATA_MODE_INVALID');
  }

  const limitValue = option(normalizedArguments, '--limit');
  if (limitValue !== undefined && mode !== 'sample') {
    throw new PesdataCliError('PESDATA_LIMIT_UNSUPPORTED');
  }
  const limit = limitValue === undefined ? undefined : Number(limitValue);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 5_000)) {
    throw new PesdataCliError('PESDATA_LIMIT_INVALID');
  }

  return {
    command: 'start',
    mode,
    actorId,
    ...(limit !== undefined ? { limit } : {}),
    dryRun
  };
}

async function run(): Promise<void> {
  const args = parsePesdataSyncArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const service = app.get(PesdataSyncService);
    const result = 'resource' in args
      ? args.command === 'resume'
        ? await app.get(PesdataTeamSyncService).resume(args.actorId, args.runId)
        : await app.get(PesdataTeamSyncService).start(args.actorId, { mode: args.mode, ...(args.limit === undefined ? {} : { limit: args.limit }) })
      : args.command === 'resume'
        ? await service.resume(args.actorId, args.runId)
        : await service.start(args.actorId, {
          mode: args.mode,
          ...(args.limit !== undefined ? { limit: args.limit } : {}),
          dryRun: args.dryRun
        });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await app.close();
  }
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entryPath) {
  void run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : 'PESDATA_SYNC_FAILED';
    process.stderr.write(`${JSON.stringify({ error: message, code })}\n`);
    process.exitCode = 1;
  });
}
