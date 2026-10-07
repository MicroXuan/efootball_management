ALTER TABLE `external_sync_runs`
    ADD COLUMN `lease_owner_token` CHAR(36) NULL;

ALTER TABLE `team_catalog_sync_runs`
    ADD COLUMN `lease_owner_token` CHAR(36) NULL;
