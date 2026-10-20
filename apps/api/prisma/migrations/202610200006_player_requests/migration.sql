CREATE TABLE `disappearance_requests` (
  `id` CHAR(36) NOT NULL,
  `league_id` CHAR(36) NOT NULL,
  `season_id` CHAR(36) NOT NULL,
  `ownership_id` CHAR(36) NOT NULL,
  `requester_team_id` CHAR(36) NOT NULL,
  `requester_user_id` CHAR(36) NOT NULL,
  `expected_ownership_version` INT UNSIGNED NOT NULL,
  `status` ENUM('PENDING','APPROVED','REJECTED','WITHDRAWN','INVALIDATED') NOT NULL DEFAULT 'PENDING',
  `reason` VARCHAR(512) NOT NULL,
  `review_reason` VARCHAR(512) NULL,
  `reviewed_by_admin_id` CHAR(36) NULL,
  `reviewed_at` DATETIME(3) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `disappearance_requests_queue_idx` (`league_id`,`status`,`created_at`),
  INDEX `disappearance_requests_team_idx` (`requester_team_id`,`created_at`),
  INDEX `disappearance_requests_ownership_idx` (`ownership_id`,`status`),
  CONSTRAINT `disappearance_requests_league_id_fkey` FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `disappearance_requests_season_id_fkey` FOREIGN KEY (`season_id`) REFERENCES `league_seasons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `disappearance_requests_ownership_id_fkey` FOREIGN KEY (`ownership_id`) REFERENCES `league_player_ownerships`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `disappearance_requests_requester_team_id_fkey` FOREIGN KEY (`requester_team_id`) REFERENCES `league_teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `disappearance_request_events` (
  `id` CHAR(36) NOT NULL,
  `request_id` CHAR(36) NOT NULL,
  `from_status` ENUM('PENDING','APPROVED','REJECTED','WITHDRAWN','INVALIDATED') NULL,
  `to_status` ENUM('PENDING','APPROVED','REJECTED','WITHDRAWN','INVALIDATED') NOT NULL,
  `actor_user_id` CHAR(36) NULL,
  `actor_admin_id` CHAR(36) NULL,
  `reason` VARCHAR(512) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `disappearance_request_events_timeline_idx` (`request_id`,`created_at`,`id`),
  CONSTRAINT `disappearance_request_events_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `disappearance_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
