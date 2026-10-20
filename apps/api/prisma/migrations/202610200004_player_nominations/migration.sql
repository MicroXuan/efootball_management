CREATE TABLE `player_nominations` (
  `id` CHAR(36) NOT NULL,
  `window_id` CHAR(36) NOT NULL,
  `league_team_id` CHAR(36) NOT NULL,
  `football_player_id` CHAR(36) NOT NULL,
  `withdrawn_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `player_nominations_unique` (`window_id`, `league_team_id`, `football_player_id`),
  INDEX `player_nominations_candidates_idx` (`window_id`, `withdrawn_at`, `football_player_id`),
  INDEX `player_nominations_team_idx` (`league_team_id`, `window_id`),
  CONSTRAINT `player_nominations_window_id_fkey` FOREIGN KEY (`window_id`) REFERENCES `nomination_windows` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_nominations_league_team_id_fkey` FOREIGN KEY (`league_team_id`) REFERENCES `league_teams` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_nominations_football_player_id_fkey` FOREIGN KEY (`football_player_id`) REFERENCES `football_players` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
