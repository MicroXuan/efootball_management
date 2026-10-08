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

DELIMITER //
CREATE PROCEDURE `assert_ownership_overall_backfill_complete`()
BEGIN
  DECLARE `missing_ownership_id` CHAR(36) DEFAULT NULL;
  DECLARE `failure_message` VARCHAR(255);

  SELECT `id`
  INTO `missing_ownership_id`
  FROM `league_player_ownerships`
  WHERE `max_overall_snapshot` IS NULL
  ORDER BY `id`
  LIMIT 1;

  IF `missing_ownership_id` IS NOT NULL THEN
    SET `failure_message` = CONCAT(
      'Cannot backfill max_overall_snapshot for ownership ',
      `missing_ownership_id`
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = `failure_message`;
  END IF;
END//
DELIMITER ;

CALL `assert_ownership_overall_backfill_complete`();
DROP PROCEDURE `assert_ownership_overall_backfill_complete`;

ALTER TABLE `league_player_ownerships`
  MODIFY COLUMN `max_overall_snapshot` TINYINT UNSIGNED NOT NULL,
  MODIFY COLUMN `dt_rating_snapshot` TINYINT UNSIGNED NULL;
