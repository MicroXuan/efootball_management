import { analyzeLeagueTeamRows, parseLeagueTeamBackfillArgs } from './league-team-backfill.cli.js';

describe('league team backfill CLI', () => {
  it('defaults to a non-mutating dry run', () => {
    expect(parseLeagueTeamBackfillArgs(['--dry-run'], 'development')).toEqual({ mode: 'dry-run', productionConfirmed: false });
  });

  it('parses repeatable apply mode', () => {
    expect(parseLeagueTeamBackfillArgs(['--apply'], 'development')).toEqual({ mode: 'apply', productionConfirmed: false });
  });

  it('refuses production apply without explicit confirmation', () => {
    expect(() => parseLeagueTeamBackfillArgs(['--apply'], 'production')).toThrow('PRODUCTION_CONFIRMATION_REQUIRED');
    expect(parseLeagueTeamBackfillArgs(['--apply', '--confirm-production'], 'production')).toEqual({ mode: 'apply', productionConfirmed: true });
  });

  it('reports unresolved numbers and duplicate ownership invariants', () => {
    const report = analyzeLeagueTeamRows([
      { id: 'a', leagueId: 'league', ownerUserId: 'owner', teamNumber: null, status: 'NEEDS_NUMBER' },
      { id: 'b', leagueId: 'league', ownerUserId: 'owner', teamNumber: 2, status: 'ACTIVE' }
    ], 3, 2);
    expect(report.unresolvedNumbers).toBe(1);
    expect(report.linkedSeasonEntries).toBe(3);
    expect(report.invariantViolations).toContain('duplicate owner owner in league league');
  });
});
