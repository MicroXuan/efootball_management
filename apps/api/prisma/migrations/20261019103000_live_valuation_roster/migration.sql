DROP INDEX `valuation_roster_snapshots_ownership_unique`
  ON `valuation_roster_snapshots`;

CREATE UNIQUE INDEX `valuation_roster_snapshots_team_ownership_unique`
  ON `valuation_roster_snapshots`(`window_id`, `league_team_id`, `ownership_id`);
