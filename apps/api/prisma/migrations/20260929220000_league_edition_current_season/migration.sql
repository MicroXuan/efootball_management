ALTER TABLE `leagues`
    ADD COLUMN `edition` ENUM('NATIONAL', 'INTERNATIONAL') NULL,
    ADD COLUMN `current_season_id` CHAR(36) NULL;

UPDATE `leagues`
SET `edition` = CASE
    WHEN UPPER(TRIM(`default_server_region`)) IN ('GLOBAL', 'INTERNATIONAL') THEN 'INTERNATIONAL'
    WHEN UPPER(TRIM(`default_server_region`)) IN ('CN', 'CHINA', 'NATIONAL') THEN 'NATIONAL'
    ELSE NULL
END;

-- This intentionally fails instead of guessing when a legacy region is unknown.
-- Diagnose before retrying with:
-- SELECT id, name, default_server_region FROM leagues WHERE edition IS NULL;
ALTER TABLE `leagues`
    MODIFY `edition` ENUM('NATIONAL', 'INTERNATIONAL') NOT NULL DEFAULT 'INTERNATIONAL';

ALTER TABLE `league_seasons`
    MODIFY `created_by_id` CHAR(36) NULL,
    ADD COLUMN `created_by_admin_id` CHAR(36) NULL;

ALTER TABLE `season_entries`
    MODIFY `game_account_id` CHAR(36) NULL,
    MODIFY `game_platform_snapshot` ENUM('MOBILE', 'PLAYSTATION', 'XBOX', 'STEAM') NULL,
    MODIFY `server_region_snapshot` VARCHAR(32) NULL,
    MODIFY `gamer_tag_snapshot` VARCHAR(64) NULL,
    ADD COLUMN `league_edition_snapshot` ENUM('NATIONAL', 'INTERNATIONAL') NULL;

UPDATE `season_entries` AS `se`
INNER JOIN `league_seasons` AS `ls` ON `ls`.`id` = `se`.`season_id`
INNER JOIN `leagues` AS `l` ON `l`.`id` = `ls`.`league_id`
SET `se`.`league_edition_snapshot` = `l`.`edition`;

ALTER TABLE `season_entries`
    MODIFY `league_edition_snapshot` ENUM('NATIONAL', 'INTERNATIONAL') NOT NULL DEFAULT 'INTERNATIONAL';

CREATE UNIQUE INDEX `leagues_current_season_id_key` ON `leagues`(`current_season_id`);
CREATE INDEX `league_seasons_admin_creator_idx` ON `league_seasons`(`created_by_admin_id`);

ALTER TABLE `leagues`
    ADD CONSTRAINT `leagues_current_season_id_fkey`
    FOREIGN KEY (`current_season_id`) REFERENCES `league_seasons`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `league_seasons`
    ADD CONSTRAINT `league_seasons_created_by_admin_id_fkey`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admin_accounts`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
