CREATE UNIQUE INDEX `standings_snapshots_scope_version_unique`
    ON `standings_snapshots`(`competition_id`, `stage_id`, `version`);

DROP INDEX `standings_snapshots_version_unique` ON `standings_snapshots`;
