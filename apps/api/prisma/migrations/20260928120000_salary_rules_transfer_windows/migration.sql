CREATE TABLE `league_salary_rule_versions` (
    `id` CHAR(36) NOT NULL,
    `league_id` CHAR(36) NOT NULL,
    `version` INT UNSIGNED NOT NULL,
    `salary_cap_minor` INT UNSIGNED NOT NULL,
    `status` ENUM('DRAFT', 'ACTIVE', 'RETIRED') NOT NULL DEFAULT 'ACTIVE',
    `effective_at` DATETIME(3) NOT NULL,
    `created_by_admin_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `league_salary_rule_versions_number_unique`(`league_id`, `version`),
    INDEX `league_salary_rule_versions_effective_idx`(`league_id`, `effective_at`, `status`),
    INDEX `league_salary_rule_versions_creator_idx`(`created_by_admin_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `league_salary_tiers` (
    `id` CHAR(36) NOT NULL,
    `salary_rule_version_id` CHAR(36) NOT NULL,
    `min_dt_rating` TINYINT UNSIGNED NOT NULL,
    `max_dt_rating` TINYINT UNSIGNED NOT NULL,
    `salary_minor` INT UNSIGNED NOT NULL,
    UNIQUE INDEX `league_salary_tiers_min_unique`(`salary_rule_version_id`, `min_dt_rating`),
    INDEX `league_salary_tiers_lookup_idx`(`salary_rule_version_id`, `max_dt_rating`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `transfer_windows` (
    `id` CHAR(36) NOT NULL,
    `season_id` CHAR(36) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `starts_at` DATETIME(3) NOT NULL,
    `ends_at` DATETIME(3) NOT NULL,
    `allow_buy` BOOLEAN NOT NULL,
    `allow_sell` BOOLEAN NOT NULL,
    `allow_transfer` BOOLEAN NOT NULL,
    `allow_card_upgrade` BOOLEAN NOT NULL,
    `created_by_admin_id` CHAR(36) NOT NULL,
    `version` INT UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    INDEX `transfer_windows_timeline_idx`(`season_id`, `starts_at`, `ends_at`),
    INDEX `transfer_windows_creator_idx`(`created_by_admin_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `league_player_ownerships` (
    `id` CHAR(36) NOT NULL,
    `league_id` CHAR(36) NOT NULL,
    `league_team_id` CHAR(36) NOT NULL,
    `football_player_id` CHAR(36) NOT NULL,
    `current_player_card_id` CHAR(36) NOT NULL,
    `dt_rating_snapshot` TINYINT UNSIGNED NOT NULL,
    `salary_rule_version_id` CHAR(36) NOT NULL,
    `salary_minor` INT UNSIGNED NOT NULL,
    `acquired_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` ENUM('ACTIVE', 'RELEASED', 'TRANSFERRED') NOT NULL DEFAULT 'ACTIVE',
    `version` INT UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `league_player_ownerships_player_unique`(`league_id`, `football_player_id`),
    INDEX `league_player_ownerships_team_status_idx`(`league_team_id`, `status`),
    INDEX `league_player_ownerships_card_idx`(`current_player_card_id`),
    INDEX `league_player_ownerships_salary_rule_idx`(`salary_rule_version_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `league_salary_rule_versions`
  ADD CONSTRAINT `league_salary_rule_versions_league_id_fkey` FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `league_salary_rule_versions_created_by_admin_id_fkey` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admin_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `league_salary_tiers`
  ADD CONSTRAINT `league_salary_tiers_salary_rule_version_id_fkey` FOREIGN KEY (`salary_rule_version_id`) REFERENCES `league_salary_rule_versions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `transfer_windows`
  ADD CONSTRAINT `transfer_windows_season_id_fkey` FOREIGN KEY (`season_id`) REFERENCES `league_seasons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `transfer_windows_created_by_admin_id_fkey` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admin_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `league_player_ownerships`
  ADD CONSTRAINT `league_player_ownerships_league_id_fkey` FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `league_player_ownerships_league_team_id_fkey` FOREIGN KEY (`league_team_id`) REFERENCES `league_teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `league_player_ownerships_football_player_id_fkey` FOREIGN KEY (`football_player_id`) REFERENCES `football_players`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `league_player_ownerships_current_player_card_id_fkey` FOREIGN KEY (`current_player_card_id`) REFERENCES `player_cards`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `league_player_ownerships_salary_rule_version_id_fkey` FOREIGN KEY (`salary_rule_version_id`) REFERENCES `league_salary_rule_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
