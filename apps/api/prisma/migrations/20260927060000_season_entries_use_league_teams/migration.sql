ALTER TABLE `season_entries`
    ADD COLUMN `team_number_snapshot` SMALLINT UNSIGNED NULL;

UPDATE `season_entries` AS `se`
INNER JOIN `league_teams` AS `lt` ON `lt`.`id` = `se`.`league_team_id`
SET `se`.`team_number_snapshot` = `lt`.`team_number`;

ALTER TABLE `season_entries`
    DROP INDEX `season_entries_team_unique`,
    MODIFY `team_profile_id` CHAR(36) NULL,
    MODIFY `league_team_id` CHAR(36) NOT NULL,
    ADD UNIQUE INDEX `season_entries_league_team_unique`(`season_id`, `league_team_id`);
