import { parsePesdataSyncArgs } from './pesdata-sync.cli.js';

const actorId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';

describe('PESDATA sync CLI arguments', () => {
  it('parses every supported command', () => {
    expect(parsePesdataSyncArgs(['sample', '--actor', actorId, '--limit', '100'])).toEqual({
      command: 'start', mode: 'sample', actorId, limit: 100, dryRun: false
    });
    expect(parsePesdataSyncArgs(['full', '--actor', actorId])).toEqual({
      command: 'start', mode: 'full', actorId, dryRun: false
    });
    expect(parsePesdataSyncArgs(['incremental', '--actor', actorId])).toEqual({
      command: 'start', mode: 'incremental', actorId, dryRun: false
    });
    expect(parsePesdataSyncArgs(['resume', runId, '--actor', actorId])).toEqual({
      command: 'resume', runId, actorId
    });
    expect(parsePesdataSyncArgs(['sample', '--actor', actorId, '--limit', '2', '--dry-run'])).toEqual({
      command: 'start', mode: 'sample', actorId, limit: 2, dryRun: true
    });
    expect(parsePesdataSyncArgs(['--', 'sample', '--actor', actorId, '--limit', '2', '--dry-run'])).toEqual({
      command: 'start', mode: 'sample', actorId, limit: 2, dryRun: true
    });
    expect(parsePesdataSyncArgs(['teams', 'sample', '--actor', actorId, '--limit', '2'])).toEqual({
      resource: 'teams', command: 'start', mode: 'sample', actorId, limit: 2
    });
    expect(parsePesdataSyncArgs(['teams', 'incremental', '--actor', actorId])).toEqual({
      resource: 'teams', command: 'start', mode: 'incremental', actorId
    });
    expect(parsePesdataSyncArgs(['teams', 'resume', runId, '--actor', actorId])).toEqual({
      resource: 'teams', command: 'resume', runId, actorId
    });
  });

  it.each([
    [['sample'], 'PESDATA_ACTOR_REQUIRED'],
    [['sample', '--actor', 'not-a-uuid'], 'PESDATA_ACTOR_INVALID'],
    [['sample', '--actor', actorId, '--limit', '0'], 'PESDATA_LIMIT_INVALID'],
    [['sample', '--actor', actorId, '--limit', '5001'], 'PESDATA_LIMIT_INVALID'],
    [['unknown', '--actor', actorId], 'PESDATA_MODE_INVALID'],
    [['resume', 'not-a-uuid', '--actor', actorId], 'PESDATA_RUN_INVALID'],
    [['resume', runId, '--actor', actorId, '--dry-run'], 'PESDATA_DRY_RUN_UNSUPPORTED']
    , [['teams', 'unknown', '--actor', actorId], 'PESDATA_TEAM_MODE_INVALID']
    , [['teams', 'full', '--actor', actorId, '--limit', '2'], 'PESDATA_TEAM_LIMIT_UNSUPPORTED']
  ])('rejects invalid arguments with %s', (arguments_, code) => {
    expect(() => parsePesdataSyncArgs(arguments_)).toThrow(expect.objectContaining({ code }));
  });
});
