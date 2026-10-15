ALTER TABLE `league_player_ownerships`
  ADD COLUMN `acquisition_type` ENUM('NORMAL', 'FORCED_TRANSFER') NOT NULL DEFAULT 'NORMAL' AFTER `salary_minor`,
  ADD COLUMN `acquisition_season_id` CHAR(36) NULL AFTER `acquisition_type`,
  ADD INDEX `league_player_ownerships_acquisition_idx` (`acquisition_season_id`, `acquisition_type`),
  ADD CONSTRAINT `league_player_ownerships_acquisition_season_fkey`
    FOREIGN KEY (`acquisition_season_id`) REFERENCES `league_seasons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `player_acquisition_applications` (
  `id` CHAR(36) NOT NULL,
  `league_id` CHAR(36) NOT NULL,
  `season_id` CHAR(36) NOT NULL,
  `transfer_window_id` CHAR(36) NOT NULL,
  `type` ENUM('NORMAL_PURCHASE', 'FORCED_TRANSFER') NOT NULL,
  `applicant_league_team_id` CHAR(36) NOT NULL,
  `football_player_id` CHAR(36) NOT NULL,
  `player_card_id` CHAR(36) NOT NULL,
  `source_league_team_id` CHAR(36) NULL,
  `ownership_id` CHAR(36) NULL,
  `ownership_version_snapshot` INTEGER UNSIGNED NULL,
  `amount_minor` INTEGER UNSIGNED NOT NULL,
  `valuation_minor_snapshot` INTEGER UNSIGNED NULL,
  `valuation_version_snapshot` INTEGER UNSIGNED NULL,
  `status` ENUM(
    'PENDING', 'APPROVED', 'NOT_SELECTED', 'REJECTED', 'WITHDRAWN',
    'EXPIRED', 'INELIGIBLE', 'REQUOTE_REQUIRED', 'OWNERSHIP_CHANGED'
  ) NOT NULL DEFAULT 'PENDING',
  `first_valid_submitted_at` DATETIME(3) NOT NULL,
  `last_submitted_at` DATETIME(3) NOT NULL,
  `reviewed_by_admin_id` CHAR(36) NULL,
  `reviewed_at` DATETIME(3) NULL,
  `review_reason` VARCHAR(512) NULL,
  `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `player_applications_market_idx` (`league_id`, `season_id`, `status`, `created_at`, `id`),
  INDEX `player_applications_team_status_idx` (`applicant_league_team_id`, `status`, `updated_at`),
  INDEX `player_applications_player_queue_idx` (`league_id`, `football_player_id`, `type`, `status`),
  INDEX `player_applications_forced_order_idx` (`ownership_id`, `ownership_version_snapshot`, `status`, `first_valid_submitted_at`, `id`),
  INDEX `player_applications_window_status_idx` (`transfer_window_id`, `status`),
  INDEX `player_applications_reviewer_idx` (`reviewed_by_admin_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `player_applications_league_fkey` FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_applications_season_fkey` FOREIGN KEY (`season_id`) REFERENCES `league_seasons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_applications_window_fkey` FOREIGN KEY (`transfer_window_id`) REFERENCES `transfer_windows`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_applications_applicant_team_fkey` FOREIGN KEY (`applicant_league_team_id`) REFERENCES `league_teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_applications_player_fkey` FOREIGN KEY (`football_player_id`) REFERENCES `football_players`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_applications_card_fkey` FOREIGN KEY (`player_card_id`) REFERENCES `player_cards`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_applications_source_team_fkey` FOREIGN KEY (`source_league_team_id`) REFERENCES `league_teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_applications_ownership_fkey` FOREIGN KEY (`ownership_id`) REFERENCES `league_player_ownerships`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_applications_reviewer_fkey` FOREIGN KEY (`reviewed_by_admin_id`) REFERENCES `admin_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `roster_transactions`
  MODIFY COLUMN `type` ENUM(
    'BUY', 'SELL', 'RELEASE', 'TRANSFER', 'FORCED_TRANSFER',
    'CARD_UPGRADE', 'SALARY_RECALCULATION', 'EMERGENCY_CORRECTION'
  ) NOT NULL,
  ADD COLUMN `player_application_id` CHAR(36) NULL AFTER `transaction_fee_rule_version_id`,
  ADD UNIQUE INDEX `roster_transactions_player_application_id_key` (`player_application_id`),
  ADD CONSTRAINT `roster_transactions_player_application_fkey`
    FOREIGN KEY (`player_application_id`) REFERENCES `player_acquisition_applications`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `player_acquisition_application_events` (
  `id` CHAR(36) NOT NULL,
  `application_id` CHAR(36) NOT NULL,
  `type` ENUM(
    'SUBMITTED', 'AMOUNT_CHANGED', 'WITHDRAWN', 'APPROVED', 'REJECTED',
    'NOT_SELECTED', 'EXPIRED', 'REQUOTE_REQUIRED', 'OWNERSHIP_CHANGED', 'INELIGIBLE'
  ) NOT NULL,
  `from_status` ENUM(
    'PENDING', 'APPROVED', 'NOT_SELECTED', 'REJECTED', 'WITHDRAWN',
    'EXPIRED', 'INELIGIBLE', 'REQUOTE_REQUIRED', 'OWNERSHIP_CHANGED'
  ) NULL,
  `to_status` ENUM(
    'PENDING', 'APPROVED', 'NOT_SELECTED', 'REJECTED', 'WITHDRAWN',
    'EXPIRED', 'INELIGIBLE', 'REQUOTE_REQUIRED', 'OWNERSHIP_CHANGED'
  ) NOT NULL,
  `from_amount_minor` INTEGER UNSIGNED NULL,
  `to_amount_minor` INTEGER UNSIGNED NULL,
  `actor_user_id` CHAR(36) NULL,
  `actor_admin_id` CHAR(36) NULL,
  `reason` VARCHAR(512) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `player_application_events_timeline_idx` (`application_id`, `created_at`, `id`),
  INDEX `player_application_events_user_idx` (`actor_user_id`, `created_at`),
  INDEX `player_application_events_admin_idx` (`actor_admin_id`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `player_application_events_application_fkey` FOREIGN KEY (`application_id`) REFERENCES `player_acquisition_applications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `player_application_events_user_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_application_events_admin_fkey` FOREIGN KEY (`actor_admin_id`) REFERENCES `admin_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `player_release_restrictions` (
  `id` CHAR(36) NOT NULL,
  `league_id` CHAR(36) NOT NULL,
  `season_id` CHAR(36) NOT NULL,
  `transfer_window_id` CHAR(36) NOT NULL,
  `league_team_id` CHAR(36) NOT NULL,
  `football_player_id` CHAR(36) NOT NULL,
  `roster_transaction_id` CHAR(36) NOT NULL,
  `created_by_user_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `player_release_restrictions_unique` (`transfer_window_id`, `league_team_id`, `football_player_id`),
  UNIQUE INDEX `player_release_restrictions_roster_transaction_key` (`roster_transaction_id`),
  INDEX `player_release_restrictions_player_idx` (`league_id`, `season_id`, `football_player_id`),
  INDEX `player_release_restrictions_user_idx` (`created_by_user_id`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `player_release_restrictions_league_fkey` FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_release_restrictions_season_fkey` FOREIGN KEY (`season_id`) REFERENCES `league_seasons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_release_restrictions_window_fkey` FOREIGN KEY (`transfer_window_id`) REFERENCES `transfer_windows`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_release_restrictions_team_fkey` FOREIGN KEY (`league_team_id`) REFERENCES `league_teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_release_restrictions_player_fkey` FOREIGN KEY (`football_player_id`) REFERENCES `football_players`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_release_restrictions_transaction_fkey` FOREIGN KEY (`roster_transaction_id`) REFERENCES `roster_transactions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_release_restrictions_user_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
