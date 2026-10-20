CREATE TABLE `forced_offer_windows` (
  `id` CHAR(36) NOT NULL,
  `season_id` CHAR(36) NOT NULL,
  `name` VARCHAR(64) NOT NULL,
  `starts_at` DATETIME(3) NOT NULL,
  `ends_at` DATETIME(3) NOT NULL,
  `created_by_admin_id` CHAR(36) NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `forced_offer_windows_timeline_idx` (`season_id`, `starts_at`, `ends_at`),
  INDEX `forced_offer_windows_creator_idx` (`created_by_admin_id`),
  CONSTRAINT `forced_offer_windows_season_id_fkey` FOREIGN KEY (`season_id`) REFERENCES `league_seasons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `forced_offer_windows_created_by_admin_id_fkey` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admin_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Preserve legacy forced applications that still reference their original transfer window.
-- New writes are validated by the service to have exactly one type-appropriate window source.
ALTER TABLE `player_acquisition_applications`
  MODIFY `transfer_window_id` CHAR(36) NULL,
  ADD COLUMN `forced_offer_window_id` CHAR(36) NULL,
  ADD INDEX `player_applications_forced_window_status_idx` (`forced_offer_window_id`, `status`),
  ADD CONSTRAINT `player_acquisition_applications_forced_offer_window_id_fkey` FOREIGN KEY (`forced_offer_window_id`) REFERENCES `forced_offer_windows`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
