ALTER TABLE `player_nominations`
  ADD COLUMN `effective_submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

UPDATE `player_nominations`
SET `effective_submitted_at` = `created_at`;

CREATE INDEX `player_nominations_priority_idx`
  ON `player_nominations`(`window_id`, `football_player_id`, `withdrawn_at`, `effective_submitted_at`, `id`);

ALTER TABLE `league_seasons`
  ADD COLUMN `playing_roster_captured_at` DATETIME(3) NULL;

CREATE TABLE `season_playing_roster_entries` (
  `id` CHAR(36) NOT NULL,
  `season_id` CHAR(36) NOT NULL,
  `league_team_id` CHAR(36) NOT NULL,
  `football_player_id` CHAR(36) NOT NULL,
  `player_card_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `season_playing_roster_player_unique` (`season_id`, `football_player_id`),
  INDEX `season_playing_roster_team_idx` (`season_id`, `league_team_id`),
  INDEX `season_playing_roster_team_fk_idx` (`league_team_id`),
  INDEX `season_playing_roster_player_fk_idx` (`football_player_id`),
  INDEX `season_playing_roster_card_fk_idx` (`player_card_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `season_playing_roster_entries`
  ADD CONSTRAINT `season_playing_roster_entries_season_id_fkey` FOREIGN KEY (`season_id`) REFERENCES `league_seasons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `season_playing_roster_entries_league_team_id_fkey` FOREIGN KEY (`league_team_id`) REFERENCES `league_teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `season_playing_roster_entries_football_player_id_fkey` FOREIGN KEY (`football_player_id`) REFERENCES `football_players`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `season_playing_roster_entries_player_card_id_fkey` FOREIGN KEY (`player_card_id`) REFERENCES `player_cards`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
