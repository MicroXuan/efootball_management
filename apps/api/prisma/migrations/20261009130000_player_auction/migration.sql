CREATE TABLE `player_auction_batches` (
  `id` CHAR(36) NOT NULL,
  `league_id` CHAR(36) NOT NULL,
  `group_binding_id` CHAR(36) NOT NULL,
  `name` VARCHAR(128) NOT NULL,
  `status` ENUM('DRAFT', 'READY', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'RECOVERY_REQUIRED') NOT NULL DEFAULT 'DRAFT',
  `current_lot_id` CHAR(36) NULL,
  `created_by_admin_id` CHAR(36) NOT NULL,
  `recovery_detected_at` DATETIME(3) NULL,
  `recovery_reason` VARCHAR(512) NULL,
  `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  `started_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `cancelled_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `player_auction_batches_current_lot_id_key` (`current_lot_id`),
  INDEX `player_auction_batches_league_status_idx` (`league_id`, `status`, `created_at`),
  INDEX `player_auction_batches_group_status_idx` (`group_binding_id`, `status`),
  INDEX `player_auction_batches_creator_idx` (`created_by_admin_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `player_auction_batches_league_id_fkey`
    FOREIGN KEY (`league_id`) REFERENCES `leagues` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_auction_batches_group_binding_id_fkey`
    FOREIGN KEY (`group_binding_id`) REFERENCES `wechat_group_bindings` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_auction_batches_created_by_admin_id_fkey`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admin_accounts` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `player_auction_lots` (
  `id` CHAR(36) NOT NULL,
  `batch_id` CHAR(36) NOT NULL,
  `football_player_id` CHAR(36) NOT NULL,
  `player_card_id` CHAR(36) NULL,
  `display_order` INTEGER UNSIGNED NOT NULL,
  `player_name_snapshot` VARCHAR(128) NOT NULL,
  `player_snapshot` JSON NOT NULL,
  `starting_price` INTEGER UNSIGNED NOT NULL,
  `minimum_increment` INTEGER UNSIGNED NOT NULL,
  `status` ENUM('QUEUED', 'ACTIVE', 'PAUSED', 'PENDING_REVIEW', 'REVIEWED', 'VOID', 'NO_BID') NOT NULL DEFAULT 'QUEUED',
  `current_price` INTEGER UNSIGNED NULL,
  `current_highest_bid_id` CHAR(36) NULL,
  `deadline_at` DATETIME(3) NULL,
  `deadline_epoch` INTEGER UNSIGNED NOT NULL DEFAULT 0,
  `last_countdown_mark` TINYINT UNSIGNED NULL,
  `paused_remaining_ms` INTEGER UNSIGNED NULL,
  `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  `started_at` DATETIME(3) NULL,
  `closed_at` DATETIME(3) NULL,
  `reviewed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `player_auction_lots_current_highest_bid_id_key` (`current_highest_bid_id`),
  UNIQUE INDEX `player_auction_lots_batch_order_unique` (`batch_id`, `display_order`),
  INDEX `player_auction_lots_batch_status_idx` (`batch_id`, `status`),
  INDEX `player_auction_lots_player_idx` (`football_player_id`),
  INDEX `player_auction_lots_card_idx` (`player_card_id`),
  INDEX `player_auction_lots_deadline_idx` (`status`, `deadline_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `player_auction_lots_batch_id_fkey`
    FOREIGN KEY (`batch_id`) REFERENCES `player_auction_batches` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_auction_lots_football_player_id_fkey`
    FOREIGN KEY (`football_player_id`) REFERENCES `football_players` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_auction_lots_player_card_id_fkey`
    FOREIGN KEY (`player_card_id`) REFERENCES `player_cards` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `player_auction_bids` (
  `id` CHAR(36) NOT NULL,
  `lot_id` CHAR(36) NOT NULL,
  `inbound_message_id` CHAR(36) NOT NULL,
  `league_team_id` CHAR(36) NULL,
  `user_id` CHAR(36) NULL,
  `identity_binding_id` CHAR(36) NULL,
  `amount` INTEGER UNSIGNED NOT NULL,
  `result` ENUM('VALID', 'BELOW_STARTING_PRICE', 'BELOW_MINIMUM_INCREMENT', 'UNBOUND', 'NO_ACTIVE_TEAM', 'WRONG_LEAGUE', 'INACTIVE', 'PAUSED', 'RECOVERY_REQUIRED', 'DEADLINE_PASSED', 'DUPLICATE', 'OVERFLOW') NOT NULL,
  `rejection_reason` VARCHAR(512) NULL,
  `wechat_message_id` VARCHAR(256) NOT NULL,
  `wechat_sort_key` VARCHAR(128) NOT NULL,
  `wechat_sent_at` DATETIME(3) NOT NULL,
  `received_at` DATETIME(3) NOT NULL,
  `became_highest_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `player_auction_bids_inbound_message_id_key` (`inbound_message_id`),
  INDEX `player_auction_bids_order_idx` (`lot_id`, `wechat_sent_at`, `wechat_sort_key`, `wechat_message_id`),
  INDEX `player_auction_bids_team_idx` (`league_team_id`, `created_at`),
  INDEX `player_auction_bids_identity_idx` (`identity_binding_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `player_auction_bids_lot_id_fkey`
    FOREIGN KEY (`lot_id`) REFERENCES `player_auction_lots` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_auction_bids_inbound_message_id_fkey`
    FOREIGN KEY (`inbound_message_id`) REFERENCES `wechat_inbound_messages` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_auction_bids_league_team_id_fkey`
    FOREIGN KEY (`league_team_id`) REFERENCES `league_teams` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_auction_bids_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_auction_bids_identity_binding_id_fkey`
    FOREIGN KEY (`identity_binding_id`) REFERENCES `wechat_identity_bindings` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `player_auction_reviews` (
  `id` CHAR(36) NOT NULL,
  `lot_id` CHAR(36) NOT NULL,
  `decision` ENUM('CONFIRM', 'ADJUST', 'VOID') NOT NULL,
  `computed_winner_team_id` CHAR(36) NULL,
  `computed_price` INTEGER UNSIGNED NULL,
  `reviewed_winner_team_id` CHAR(36) NULL,
  `reviewed_price` INTEGER UNSIGNED NULL,
  `reviewed_by_admin_id` CHAR(36) NOT NULL,
  `reason` VARCHAR(512) NULL,
  `reviewed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `player_auction_reviews_lot_id_key` (`lot_id`),
  INDEX `player_auction_reviews_computed_team_idx` (`computed_winner_team_id`),
  INDEX `player_auction_reviews_reviewed_team_idx` (`reviewed_winner_team_id`),
  INDEX `player_auction_reviews_admin_idx` (`reviewed_by_admin_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `player_auction_reviews_lot_id_fkey`
    FOREIGN KEY (`lot_id`) REFERENCES `player_auction_lots` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_auction_reviews_computed_winner_team_id_fkey`
    FOREIGN KEY (`computed_winner_team_id`) REFERENCES `league_teams` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_auction_reviews_reviewed_winner_team_id_fkey`
    FOREIGN KEY (`reviewed_winner_team_id`) REFERENCES `league_teams` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `player_auction_reviews_reviewed_by_admin_id_fkey`
    FOREIGN KEY (`reviewed_by_admin_id`) REFERENCES `admin_accounts` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `player_auction_batches`
  ADD CONSTRAINT `player_auction_batches_current_lot_id_fkey`
  FOREIGN KEY (`current_lot_id`) REFERENCES `player_auction_lots` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `player_auction_lots`
  ADD CONSTRAINT `player_auction_lots_current_highest_bid_id_fkey`
  FOREIGN KEY (`current_highest_bid_id`) REFERENCES `player_auction_bids` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
