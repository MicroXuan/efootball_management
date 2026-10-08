ALTER TABLE `external_sync_runs`
    ADD COLUMN `current_phase` VARCHAR(64) NULL,
    ADD COLUMN `heartbeat_at` DATETIME(3) NULL,
    ADD COLUMN `lease_expires_at` DATETIME(3) NULL;

CREATE INDEX `external_sync_runs_lease_idx`
    ON `external_sync_runs`(`status`, `lease_expires_at`);

ALTER TABLE `team_catalog_sync_runs`
    ADD COLUMN `current_phase` VARCHAR(64) NULL,
    ADD COLUMN `heartbeat_at` DATETIME(3) NULL,
    ADD COLUMN `lease_expires_at` DATETIME(3) NULL;

CREATE INDEX `team_catalog_sync_runs_lease_idx`
    ON `team_catalog_sync_runs`(`status`, `lease_expires_at`);
