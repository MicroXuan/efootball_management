CREATE TABLE `nomination_windows` (
  `id` CHAR(36) NOT NULL,
  `season_id` CHAR(36) NOT NULL,
  `starts_at` DATETIME(3) NOT NULL,
  `ends_at` DATETIME(3) NOT NULL,
  `per_team_limit` SMALLINT UNSIGNED NOT NULL,
  `created_by_admin_id` CHAR(36) NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `nomination_windows_season_timeline_idx` (`season_id`, `starts_at`, `ends_at`),
  INDEX `nomination_windows_creator_idx` (`created_by_admin_id`),
  CONSTRAINT `nomination_windows_season_id_fkey` FOREIGN KEY (`season_id`) REFERENCES `league_seasons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `nomination_windows_created_by_admin_id_fkey` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admin_accounts` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
