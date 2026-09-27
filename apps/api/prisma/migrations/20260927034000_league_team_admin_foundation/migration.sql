-- Add a nullable public number first so existing and rolling application versions remain writable.
ALTER TABLE `users` ADD COLUMN `public_user_no` CHAR(6) NULL;

CREATE TEMPORARY TABLE `_user_public_number_backfill` AS
SELECT
    `id`,
    LPAD(100000 + ROW_NUMBER() OVER (ORDER BY `created_at`, `id`), 6, '0') AS `public_user_no`
FROM `users`;

UPDATE `users` AS `u`
INNER JOIN `_user_public_number_backfill` AS `b` ON `b`.`id` = `u`.`id`
SET `u`.`public_user_no` = `b`.`public_user_no`;

DROP TEMPORARY TABLE `_user_public_number_backfill`;

CREATE UNIQUE INDEX `users_public_user_no_key` ON `users`(`public_user_no`);

CREATE TABLE `public_user_number_sequences` (
    `key` VARCHAR(32) NOT NULL,
    `next_value` INTEGER UNSIGNED NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `public_user_number_sequences` (`key`, `next_value`, `updated_at`)
SELECT
    'public-users',
    GREATEST(COALESCE(MAX(CAST(`public_user_no` AS UNSIGNED)) + 1, 100001), 100001),
    CURRENT_TIMESTAMP(3)
FROM `users`;

CREATE TABLE `admin_accounts` (
    `id` CHAR(36) NOT NULL,
    `username` VARCHAR(64) NOT NULL,
    `display_name` VARCHAR(64) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `platform_role` ENUM('PLATFORM_ADMIN', 'LEAGUE_MANAGER') NULL,
    `failed_login_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `locked_until` DATETIME(3) NULL,
    `last_login_at` DATETIME(3) NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `admin_accounts_username_key`(`username`),
    INDEX `admin_accounts_status_username_idx`(`status`, `username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `admin_sessions` (
    `id` CHAR(36) NOT NULL,
    `admin_id` CHAR(36) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `family_id` CHAR(36) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `replaced_by_session_id` CHAR(36) NULL,
    `ip_address` VARCHAR(45) NULL,
    `user_agent` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `admin_sessions_token_hash_key`(`token_hash`),
    INDEX `admin_sessions_admin_id_idx`(`admin_id`),
    INDEX `admin_sessions_family_id_idx`(`family_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `admin_league_roles` (
    `id` CHAR(36) NOT NULL,
    `admin_id` CHAR(36) NOT NULL,
    `league_id` CHAR(36) NOT NULL,
    `role` ENUM('PLATFORM_ADMIN', 'LEAGUE_MANAGER') NOT NULL DEFAULT 'LEAGUE_MANAGER',
    `granted_by_id` CHAR(36) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `admin_league_roles_scope_idx`(`league_id`, `role`, `revoked_at`),
    INDEX `admin_league_roles_grantor_idx`(`granted_by_id`),
    UNIQUE INDEX `admin_league_roles_unique`(`admin_id`, `league_id`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `league_teams` (
    `id` CHAR(36) NOT NULL,
    `league_id` CHAR(36) NOT NULL,
    `owner_user_id` CHAR(36) NOT NULL,
    `team_number` SMALLINT UNSIGNED NULL,
    `name` VARCHAR(64) NOT NULL,
    `short_name` VARCHAR(24) NOT NULL,
    `logo_url` VARCHAR(2048) NULL,
    `default_game_account_id` CHAR(36) NULL,
    `status` ENUM('ACTIVE', 'ARCHIVED', 'NEEDS_NUMBER') NOT NULL DEFAULT 'ACTIVE',
    `roster_status` ENUM('COMPLIANT', 'OVER_CAP') NOT NULL DEFAULT 'COMPLIANT',
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `league_teams_default_account_idx`(`default_game_account_id`),
    INDEX `league_teams_status_idx`(`league_id`, `status`, `created_at`),
    UNIQUE INDEX `league_teams_owner_unique`(`league_id`, `owner_user_id`),
    UNIQUE INDEX `league_teams_number_unique`(`league_id`, `team_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `league_teams` (
    `id`,
    `league_id`,
    `owner_user_id`,
    `team_number`,
    `name`,
    `short_name`,
    `logo_url`,
    `default_game_account_id`,
    `status`,
    `roster_status`,
    `version`,
    `created_at`,
    `updated_at`
)
SELECT
    UUID(),
    `ls`.`league_id`,
    `tp`.`owner_user_id`,
    NULL,
    `tp`.`name`,
    `tp`.`short_name`,
    `tp`.`logo_url`,
    `tp`.`default_game_account_id`,
    'NEEDS_NUMBER',
    'COMPLIANT',
    1,
    MIN(`se`.`created_at`),
    CURRENT_TIMESTAMP(3)
FROM `season_entries` AS `se`
INNER JOIN `league_seasons` AS `ls` ON `ls`.`id` = `se`.`season_id`
INNER JOIN `team_profiles` AS `tp` ON `tp`.`id` = `se`.`team_profile_id`
GROUP BY
    `ls`.`league_id`,
    `tp`.`owner_user_id`,
    `tp`.`name`,
    `tp`.`short_name`,
    `tp`.`logo_url`,
    `tp`.`default_game_account_id`;

ALTER TABLE `season_entries` ADD COLUMN `league_team_id` CHAR(36) NULL;

UPDATE `season_entries` AS `se`
INNER JOIN `league_seasons` AS `ls` ON `ls`.`id` = `se`.`season_id`
INNER JOIN `league_teams` AS `lt`
    ON `lt`.`league_id` = `ls`.`league_id`
    AND `lt`.`owner_user_id` = `se`.`owner_user_id`
SET `se`.`league_team_id` = `lt`.`id`;

CREATE INDEX `season_entries_league_team_idx` ON `season_entries`(`league_team_id`);

CREATE TABLE `audit_logs` (
    `id` CHAR(36) NOT NULL,
    `actor_admin_id` CHAR(36) NOT NULL,
    `league_id` CHAR(36) NULL,
    `action` VARCHAR(128) NOT NULL,
    `resource_type` VARCHAR(64) NOT NULL,
    `resource_id` CHAR(36) NULL,
    `reason` VARCHAR(512) NULL,
    `metadata` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_actor_idx`(`actor_admin_id`, `created_at`),
    INDEX `audit_logs_league_idx`(`league_id`, `created_at`),
    INDEX `audit_logs_resource_idx`(`resource_type`, `resource_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `admin_sessions` ADD CONSTRAINT `admin_sessions_admin_id_fkey`
    FOREIGN KEY (`admin_id`) REFERENCES `admin_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `admin_league_roles` ADD CONSTRAINT `admin_league_roles_admin_id_fkey`
    FOREIGN KEY (`admin_id`) REFERENCES `admin_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `admin_league_roles` ADD CONSTRAINT `admin_league_roles_league_id_fkey`
    FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `admin_league_roles` ADD CONSTRAINT `admin_league_roles_granted_by_id_fkey`
    FOREIGN KEY (`granted_by_id`) REFERENCES `admin_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `league_teams` ADD CONSTRAINT `league_teams_league_id_fkey`
    FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `league_teams` ADD CONSTRAINT `league_teams_owner_user_id_fkey`
    FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `league_teams` ADD CONSTRAINT `league_teams_default_game_account_id_fkey`
    FOREIGN KEY (`default_game_account_id`) REFERENCES `game_accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `season_entries` ADD CONSTRAINT `season_entries_league_team_id_fkey`
    FOREIGN KEY (`league_team_id`) REFERENCES `league_teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_admin_id_fkey`
    FOREIGN KEY (`actor_admin_id`) REFERENCES `admin_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_league_id_fkey`
    FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
