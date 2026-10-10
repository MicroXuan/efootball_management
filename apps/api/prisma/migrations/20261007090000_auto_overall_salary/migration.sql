ALTER TABLE `league_salary_tiers`
  CHANGE COLUMN `min_dt_rating` `min_overall` TINYINT UNSIGNED NOT NULL,
  CHANGE COLUMN `max_dt_rating` `max_overall` TINYINT UNSIGNED NOT NULL;

ALTER TABLE `league_player_ownerships`
  ADD COLUMN `max_overall_snapshot` TINYINT UNSIGNED NULL AFTER `current_player_card_id`;

UPDATE `league_player_ownerships` AS `ownership`
INNER JOIN `player_card_auto_builds` AS `auto_build`
  ON `auto_build`.`id` = (
    SELECT `latest_auto_build`.`id`
    FROM `player_card_auto_builds` AS `latest_auto_build`
    WHERE `latest_auto_build`.`player_card_id` = `ownership`.`current_player_card_id`
    ORDER BY `latest_auto_build`.`calculated_at` DESC, `latest_auto_build`.`id` DESC
    LIMIT 1
  )
SET `ownership`.`max_overall_snapshot` = `auto_build`.`max_overall`;

CREATE TEMPORARY TABLE `_auto_overall_backfill_guard` (
  `ownership_id` CHAR(36) NOT NULL,
  PRIMARY KEY (`ownership_id`)
);

CREATE TEMPORARY TABLE `_auto_overall_backfill_failure` (
  `ownership_id` CHAR(36) NOT NULL,
  PRIMARY KEY (`ownership_id`)
);

INSERT INTO `_auto_overall_backfill_guard` (`ownership_id`)
  SELECT `id`
  FROM `league_player_ownerships`
  WHERE `max_overall_snapshot` IS NULL
  ORDER BY `id`;

-- If any ownership could not be backfilled, this deliberately fails with a
-- duplicate-key error whose value is the first missing ownership ID.
INSERT INTO `_auto_overall_backfill_failure` (`ownership_id`)
  SELECT `ownership_id`
  FROM `_auto_overall_backfill_guard`
  ORDER BY `ownership_id`
  LIMIT 1;

INSERT INTO `_auto_overall_backfill_failure` (`ownership_id`)
  SELECT `ownership_id`
  FROM `_auto_overall_backfill_guard`
  ORDER BY `ownership_id`
  LIMIT 1;

DROP TEMPORARY TABLE `_auto_overall_backfill_guard`;
DROP TEMPORARY TABLE `_auto_overall_backfill_failure`;

ALTER TABLE `league_player_ownerships`
  MODIFY COLUMN `max_overall_snapshot` TINYINT UNSIGNED NOT NULL,
  MODIFY COLUMN `dt_rating_snapshot` TINYINT UNSIGNED NULL;
