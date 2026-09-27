-- AlterTable
ALTER TABLE `user_role_bindings` MODIFY `scope_type` ENUM('PLATFORM', 'ORGANIZATION', 'LEAGUE', 'SEASON', 'COMPETITION', 'TEAM') NOT NULL;

-- CreateTable
CREATE TABLE `leagues` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `short_name` VARCHAR(24) NOT NULL,
    `description` VARCHAR(500) NOT NULL DEFAULT '',
    `logo_url` VARCHAR(2048) NULL,
    `status` ENUM('ACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `default_platform` ENUM('MOBILE', 'PLAYSTATION', 'XBOX', 'STEAM') NOT NULL,
    `default_server_region` VARCHAR(32) NOT NULL,
    `default_super_capacity` SMALLINT UNSIGNED NOT NULL DEFAULT 23,
    `default_champion_capacity` SMALLINT UNSIGNED NOT NULL DEFAULT 18,
    `default_promotion_count` SMALLINT UNSIGNED NOT NULL DEFAULT 4,
    `created_by_id` CHAR(36) NOT NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `leagues_public_list_idx`(`status`, `created_at`, `id`),
    INDEX `leagues_creator_idx`(`created_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `team_profiles` (
    `id` CHAR(36) NOT NULL,
    `owner_user_id` CHAR(36) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `short_name` VARCHAR(24) NOT NULL,
    `logo_url` VARCHAR(2048) NULL,
    `default_game_account_id` CHAR(36) NULL,
    `status` ENUM('ACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `team_profiles_owner_user_id_key`(`owner_user_id`),
    INDEX `team_profiles_default_account_idx`(`default_game_account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `league_seasons` (
    `id` CHAR(36) NOT NULL,
    `league_id` CHAR(36) NOT NULL,
    `season_number` INTEGER UNSIGNED NOT NULL,
    `display_name` VARCHAR(64) NOT NULL,
    `previous_season_id` CHAR(36) NULL,
    `is_first_season` BOOLEAN NOT NULL DEFAULT false,
    `registration_opens_at` DATETIME(3) NOT NULL,
    `registration_closes_at` DATETIME(3) NOT NULL,
    `starts_at` DATETIME(3) NOT NULL,
    `ends_at` DATETIME(3) NOT NULL,
    `super_capacity` SMALLINT UNSIGNED NOT NULL,
    `champion_capacity` SMALLINT UNSIGNED NOT NULL,
    `promotion_count` SMALLINT UNSIGNED NOT NULL,
    `status` ENUM('DRAFT', 'REGISTRATION_OPEN', 'ALLOCATION_REVIEW', 'READY', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `cancellation_reason` VARCHAR(512) NULL,
    `created_by_id` CHAR(36) NOT NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `league_seasons_previous_season_id_key`(`previous_season_id`),
    INDEX `league_seasons_status_idx`(`league_id`, `status`),
    INDEX `league_seasons_timeline_idx`(`league_id`, `registration_opens_at`, `id`),
    INDEX `league_seasons_creator_idx`(`created_by_id`),
    UNIQUE INDEX `league_seasons_number_unique`(`league_id`, `season_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `league_season_status_history` (
    `id` CHAR(36) NOT NULL,
    `season_id` CHAR(36) NOT NULL,
    `from_status` ENUM('DRAFT', 'REGISTRATION_OPEN', 'ALLOCATION_REVIEW', 'READY', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NULL,
    `to_status` ENUM('DRAFT', 'REGISTRATION_OPEN', 'ALLOCATION_REVIEW', 'READY', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL,
    `actor_id` CHAR(36) NOT NULL,
    `reason` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `league_season_status_history_idx`(`season_id`, `created_at`),
    INDEX `league_season_status_actor_idx`(`actor_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `season_entries` (
    `id` CHAR(36) NOT NULL,
    `season_id` CHAR(36) NOT NULL,
    `team_profile_id` CHAR(36) NOT NULL,
    `owner_user_id` CHAR(36) NOT NULL,
    `game_account_id` CHAR(36) NOT NULL,
    `source` ENUM('NEW_APPLICATION', 'RENEWAL') NOT NULL,
    `status` ENUM('INVITED', 'PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN') NOT NULL DEFAULT 'PENDING',
    `previous_season_entry_id` CHAR(36) NULL,
    `team_name_snapshot` VARCHAR(64) NOT NULL,
    `team_short_name_snapshot` VARCHAR(24) NOT NULL,
    `team_logo_url_snapshot` VARCHAR(2048) NULL,
    `game_platform_snapshot` ENUM('MOBILE', 'PLAYSTATION', 'XBOX', 'STEAM') NOT NULL,
    `server_region_snapshot` VARCHAR(32) NOT NULL,
    `gamer_tag_snapshot` VARCHAR(64) NOT NULL,
    `game_uid_snapshot` VARCHAR(64) NULL,
    `reviewed_by_id` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `decision_reason` VARCHAR(512) NULL,
    `confirmed_at` DATETIME(3) NULL,
    `withdrawn_at` DATETIME(3) NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `season_entries_previous_season_entry_id_key`(`previous_season_entry_id`),
    INDEX `season_entries_review_idx`(`season_id`, `status`, `source`, `created_at`),
    INDEX `season_entries_owner_idx`(`owner_user_id`, `season_id`),
    INDEX `season_entries_account_idx`(`game_account_id`),
    INDEX `season_entries_reviewer_idx`(`reviewed_by_id`),
    UNIQUE INDEX `season_entries_team_unique`(`season_id`, `team_profile_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `season_entry_status_history` (
    `id` CHAR(36) NOT NULL,
    `season_entry_id` CHAR(36) NOT NULL,
    `from_status` ENUM('INVITED', 'PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN') NULL,
    `to_status` ENUM('INVITED', 'PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN') NOT NULL,
    `actor_id` CHAR(36) NOT NULL,
    `reason` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `season_entry_status_history_idx`(`season_entry_id`, `created_at`),
    INDEX `season_entry_status_actor_idx`(`actor_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `leagues` ADD CONSTRAINT `leagues_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_profiles` ADD CONSTRAINT `team_profiles_owner_user_id_fkey` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_profiles` ADD CONSTRAINT `team_profiles_default_game_account_id_fkey` FOREIGN KEY (`default_game_account_id`) REFERENCES `game_accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `league_seasons` ADD CONSTRAINT `league_seasons_league_id_fkey` FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `league_seasons` ADD CONSTRAINT `league_seasons_previous_season_id_fkey` FOREIGN KEY (`previous_season_id`) REFERENCES `league_seasons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `league_seasons` ADD CONSTRAINT `league_seasons_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `league_season_status_history` ADD CONSTRAINT `league_season_status_history_season_id_fkey` FOREIGN KEY (`season_id`) REFERENCES `league_seasons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `league_season_status_history` ADD CONSTRAINT `league_season_status_history_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `season_entries` ADD CONSTRAINT `season_entries_season_id_fkey` FOREIGN KEY (`season_id`) REFERENCES `league_seasons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `season_entries` ADD CONSTRAINT `season_entries_team_profile_id_fkey` FOREIGN KEY (`team_profile_id`) REFERENCES `team_profiles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `season_entries` ADD CONSTRAINT `season_entries_owner_user_id_fkey` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `season_entries` ADD CONSTRAINT `season_entries_game_account_id_fkey` FOREIGN KEY (`game_account_id`) REFERENCES `game_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `season_entries` ADD CONSTRAINT `season_entries_previous_season_entry_id_fkey` FOREIGN KEY (`previous_season_entry_id`) REFERENCES `season_entries`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `season_entries` ADD CONSTRAINT `season_entries_reviewed_by_id_fkey` FOREIGN KEY (`reviewed_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `season_entry_status_history` ADD CONSTRAINT `season_entry_status_history_season_entry_id_fkey` FOREIGN KEY (`season_entry_id`) REFERENCES `season_entries`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `season_entry_status_history` ADD CONSTRAINT `season_entry_status_history_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
