import { readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NestFactory } from '@nestjs/core';
import type { ImportFormat } from '@efm/contracts';
import { AppModule } from '../app.module.js';
import { PlayerImportPublisher } from './player-import.publisher.js';
import { PlayerImportService } from './player-import.service.js';

type ValidateArgs = {
  command: 'validate';
  filePath: string;
  format: ImportFormat;
  sourceCode: string;
  actorId: string;
};

type PublishArgs = {
  command: 'publish';
  batchId: string;
  actorId: string;
};

export type PlayerImportArgs = ValidateArgs | PublishArgs;

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function requiredActor(argv: string[]): string {
  const actorId = option(argv, '--actor');
  if (!actorId || actorId.startsWith('--')) throw new Error('IMPORT_ACTOR_REQUIRED');
  return actorId;
}

export function parsePlayerImportArgs(argv: string[]): PlayerImportArgs {
  const [command, target] = argv;
  if (command === 'validate') {
    if (!target || target.startsWith('--')) throw new Error('IMPORT_FILE_REQUIRED');
    const extension = extname(target).toLocaleLowerCase('en-US');
    const format = extension === '.json' ? 'JSON' : extension === '.csv' ? 'CSV' : null;
    if (!format) throw new Error('UNSUPPORTED_IMPORT_FORMAT');
    const sourceCode = option(argv, '--source');
    if (!sourceCode || sourceCode.startsWith('--')) throw new Error('IMPORT_SOURCE_REQUIRED');
    return { command, filePath: target, format, sourceCode, actorId: requiredActor(argv) };
  }
  if (command === 'publish') {
    if (!target || target.startsWith('--')) throw new Error('IMPORT_BATCH_REQUIRED');
    return { command, batchId: target, actorId: requiredActor(argv) };
  }
  throw new Error('IMPORT_COMMAND_REQUIRED');
}

async function run(): Promise<void> {
  const args = parsePlayerImportArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const result = args.command === 'validate'
      ? await app.get(PlayerImportService).createBatch(args.actorId, {
          sourceCode: args.sourceCode,
          fileName: basename(args.filePath),
          format: args.format,
          content: await readFile(resolve(args.filePath), 'utf8')
        })
      : await app.get(PlayerImportPublisher).publish(args.actorId, args.batchId);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await app.close();
  }
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entryPath) {
  void run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ error: message })}\n`);
    process.exitCode = 1;
  });
}
