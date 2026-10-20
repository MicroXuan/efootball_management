ALTER TABLE `player_auction_reviews`
  ADD COLUMN `winner_team_number_snapshot` SMALLINT UNSIGNED NULL,
  ADD COLUMN `winner_team_name_snapshot` VARCHAR(64) NULL,
  ADD COLUMN `winner_display_name_snapshot` VARCHAR(32) NULL;
