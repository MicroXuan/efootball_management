ALTER TABLE `league_player_ownerships`
  ADD COLUMN `bird_baseline_overall` TINYINT UNSIGNED NULL,
  ADD COLUMN `bird_discount_applied` BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE `league_player_ownerships`
SET `bird_baseline_overall` = `max_overall_snapshot`;
