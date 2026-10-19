import { jest } from '@jest/globals';
import type { PrismaService } from '../database/prisma.service.js';
import {
  parseRollbackCheckOptions,
  runPublicationRollbackChecks
} from './player-import-publication.rollback-check.js';

const options = {
  batchId: 'batch-1',
  adminId: 'admin-1',
  repeat: 1,
  performanceTargetMs: 30_000
};

function prismaWithTransaction() {
  return {
    $transaction: jest.fn(async (callback: (tx: object) => Promise<unknown>) => callback({}))
  } as unknown as PrismaService;
}

describe('publication rollback acceptance runner', () => {
  it('requires batch id admin id and a positive repeat count', () => {
    expect(() => parseRollbackCheckOptions([])).toThrow('batch-id');
    expect(() => parseRollbackCheckOptions(['--batch-id', 'batch-1'])).toThrow('admin-id');
    expect(() => parseRollbackCheckOptions([
      '--batch-id', 'batch-1', '--admin-id', 'admin-1'
    ])).toThrow('repeat');
    expect(() => parseRollbackCheckOptions([
      '--batch-id', 'batch-1', '--admin-id', 'admin-1', '--repeat', '0'
    ])).toThrow('repeat');
    expect(parseRollbackCheckOptions([
      '--batch-id', 'batch-1', '--admin-id', 'admin-1', '--repeat', '3'
    ])).toEqual({ ...options, repeat: 3 });
  });

  it('throws a private rollback sentinel after the full publication graph', async () => {
    const prisma = prismaWithTransaction();
    const execute = jest.fn(async () => ({ status: 'PUBLISHED' }));
    const capture = jest.fn(async () => ({ releases: 0, cards: 0 }));

    const result = await runPublicationRollbackChecks(prisma, options, {
      prepare: async () => ({
        batchId: options.batchId,
        preparedRecords: [],
        snapshotKey: 'snapshot'
      }),
      execute,
      capture,
      assertBatchUnchanged: async () => undefined,
      now: (() => {
        const values = [100, 125];
        return () => values.shift() ?? 125;
      })()
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{
      attempt: 1,
      elapsedMs: 25,
      before: { releases: 0, cards: 0 },
      after: { releases: 0, cards: 0 }
    }]);

    const publicationFailure = new Error('publication failed');
    await expect(runPublicationRollbackChecks(prismaWithTransaction(), options, {
      prepare: async () => ({
        batchId: options.batchId,
        preparedRecords: [],
        snapshotKey: 'snapshot'
      }),
      execute: async () => { throw publicationFailure; },
      capture: async () => ({ releases: 0 }),
      assertBatchUnchanged: async () => undefined,
      now: () => 0
    })).rejects.toBe(publicationFailure);
  });

  it('reports failure when any before and after count differs', async () => {
    const prisma = prismaWithTransaction();
    const captures = [{ releases: 0, cards: 0 }, { releases: 0, cards: 1 }];

    await expect(runPublicationRollbackChecks(prisma, options, {
      prepare: async () => ({
        batchId: options.batchId,
        preparedRecords: [],
        snapshotKey: 'snapshot'
      }),
      execute: async () => ({ status: 'PUBLISHED' }) as never,
      capture: async () => captures.shift()!,
      assertBatchUnchanged: async () => undefined,
      now: () => 0
    })).rejects.toThrow('cards');
  });

  it('runs the requested number of successful rollback checks', async () => {
    const prisma = prismaWithTransaction();
    const execute = jest.fn(async () => ({ status: 'PUBLISHED' }));

    const result = await runPublicationRollbackChecks(prisma, { ...options, repeat: 3 }, {
      prepare: async () => ({
        batchId: options.batchId,
        preparedRecords: [],
        snapshotKey: 'snapshot'
      }),
      execute,
      capture: async () => ({ releases: 0 }),
      assertBatchUnchanged: async () => undefined,
      now: () => 0
    });

    expect(execute).toHaveBeenCalledTimes(3);
    expect(result.map(({ attempt }) => attempt)).toEqual([1, 2, 3]);
  });
});
