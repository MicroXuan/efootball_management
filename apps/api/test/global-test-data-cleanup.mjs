import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export default function globalTestDataCleanup() {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(command, ['exec', 'tsx', 'test/run-test-data-cleanup.ts'], {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    throw new Error(`Test artifact cleanup failed with exit code ${result.status ?? 'unknown'}`);
  }
}
