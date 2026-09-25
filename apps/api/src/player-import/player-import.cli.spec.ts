import { parsePlayerImportArgs } from './player-import.cli.js';

const actorId = '11111111-1111-4111-8111-111111111111';

describe('parsePlayerImportArgs', () => {
  it('parses validate with an inferred JSON format', () => {
    expect(parsePlayerImportArgs([
      'validate',
      'fixtures/player-import/sample-player-cards.json',
      '--source',
      'manual',
      '--actor',
      actorId
    ])).toEqual({
      command: 'validate',
      filePath: 'fixtures/player-import/sample-player-cards.json',
      format: 'JSON',
      sourceCode: 'manual',
      actorId
    });
  });

  it('parses publish', () => {
    const batchId = '22222222-2222-4222-8222-222222222222';
    expect(parsePlayerImportArgs(['publish', batchId, '--actor', actorId])).toEqual({
      command: 'publish',
      batchId,
      actorId
    });
  });

  it('rejects missing paths, actors, and unsupported extensions', () => {
    expect(() => parsePlayerImportArgs(['validate', '--source', 'manual', '--actor', actorId]))
      .toThrow('IMPORT_FILE_REQUIRED');
    expect(() => parsePlayerImportArgs(['validate', 'players.xlsx', '--source', 'manual', '--actor', actorId]))
      .toThrow('UNSUPPORTED_IMPORT_FORMAT');
    expect(() => parsePlayerImportArgs(['publish', 'batch-id'])).toThrow('IMPORT_ACTOR_REQUIRED');
  });
});
