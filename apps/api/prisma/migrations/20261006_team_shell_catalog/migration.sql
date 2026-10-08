CREATE TABLE `team_catalog_items` (
    `id` CHAR(36) NOT NULL,
    `source_type` ENUM('PESDATA', 'CUSTOM') NOT NULL,
    `source_external_id` VARCHAR(128) NULL,
    `source_league_external_id` VARCHAR(128) NULL,
    `source_league_name` VARCHAR(128) NULL,
    `name_zh` VARCHAR(64) NULL,
    `name_en` VARCHAR(64) NULL,
    `name_ja` VARCHAR(64) NULL,
    `short_name` VARCHAR(24) NOT NULL,
    `remote_logo_url` VARCHAR(2048) NULL,
    `stored_logo_url` VARCHAR(2048) NULL,
    `logo_checksum` CHAR(64) NULL,
    `source_checksum` CHAR(64) NULL,
    `status` ENUM('ACTIVE', 'SOURCE_UNCONFIRMED', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `source_updated_at` DATETIME(3) NULL,
    `last_synced_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `team_catalog_source_external_unique`(`source_type`, `source_external_id`),
    INDEX `team_catalog_browse_idx`(`status`, `source_league_name`, `name_zh`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `league_teams`
    ADD COLUMN `owner_alias` VARCHAR(32) NULL,
    ADD COLUMN `catalog_team_id` CHAR(36) NULL;

INSERT INTO `team_catalog_items` (
    `id`, `source_type`, `source_external_id`, `name_zh`, `name_en`, `name_ja`,
    `short_name`, `stored_logo_url`, `status`, `created_at`, `updated_at`
)
SELECT
    `id`, 'CUSTOM', NULL, `name`, NULL, NULL,
    `short_name`, `logo_url`, 'ACTIVE', `created_at`, `updated_at`
FROM `league_teams`;

UPDATE `league_teams` AS `team`
INNER JOIN `users` AS `owner` ON `owner`.`id` = `team`.`owner_user_id`
SET
    `team`.`owner_alias` = `owner`.`display_name`,
    `team`.`catalog_team_id` = `team`.`id`;

ALTER TABLE `league_teams`
    MODIFY `owner_alias` VARCHAR(32) NOT NULL,
    MODIFY `catalog_team_id` CHAR(36) NOT NULL;

CREATE UNIQUE INDEX `league_teams_catalog_unique`
    ON `league_teams`(`league_id`, `catalog_team_id`);
CREATE INDEX `league_teams_catalog_idx`
    ON `league_teams`(`catalog_team_id`);

ALTER TABLE `league_teams`
    ADD CONSTRAINT `league_teams_catalog_team_id_fkey`
    FOREIGN KEY (`catalog_team_id`) REFERENCES `team_catalog_items`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `league_team_shell_history` (
    `id` CHAR(36) NOT NULL,
    `league_id` CHAR(36) NOT NULL,
    `league_team_id` CHAR(36) NOT NULL,
    `related_league_team_id` CHAR(36) NULL,
    `change_type` ENUM('ASSIGN', 'CHANGE', 'TRANSFER', 'SWAP', 'REFRESH') NOT NULL,
    `from_catalog_team_id` CHAR(36) NULL,
    `to_catalog_team_id` CHAR(36) NOT NULL,
    `actor_admin_id` CHAR(36) NOT NULL,
    `reason` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `team_shell_history_team_idx`(`league_team_id`, `created_at`),
    INDEX `team_shell_history_related_idx`(`related_league_team_id`),
    INDEX `team_shell_history_actor_idx`(`actor_admin_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `league_team_shell_history`
    ADD CONSTRAINT `team_shell_history_league_fkey`
        FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `team_shell_history_team_fkey`
        FOREIGN KEY (`league_team_id`) REFERENCES `league_teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `team_shell_history_related_team_fkey`
        FOREIGN KEY (`related_league_team_id`) REFERENCES `league_teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `team_shell_history_from_catalog_fkey`
        FOREIGN KEY (`from_catalog_team_id`) REFERENCES `team_catalog_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `team_shell_history_to_catalog_fkey`
        FOREIGN KEY (`to_catalog_team_id`) REFERENCES `team_catalog_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `team_shell_history_actor_fkey`
        FOREIGN KEY (`actor_admin_id`) REFERENCES `admin_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `team_catalog_sync_runs` (
    `id` CHAR(36) NOT NULL,
    `actor_admin_id` CHAR(36) NOT NULL,
    `mode` ENUM('SAMPLE', 'FULL', 'INCREMENTAL', 'RESUME') NOT NULL,
    `status` ENUM('PENDING', 'RUNNING', 'READY', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `active_lease_key` VARCHAR(64) NULL,
    `requested_limit` INTEGER UNSIGNED NULL,
    `scanned_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `added_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `updated_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `missing_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `failed_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `current_offset` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `error_code` VARCHAR(128) NULL,
    `error_message` VARCHAR(512) NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `team_catalog_sync_runs_active_lease_key_key`(`active_lease_key`),
    INDEX `team_catalog_sync_runs_status_idx`(`status`, `created_at`),
    INDEX `team_catalog_sync_runs_actor_idx`(`actor_admin_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `team_catalog_sync_runs`
    ADD CONSTRAINT `team_catalog_sync_runs_actor_fkey`
    FOREIGN KEY (`actor_admin_id`) REFERENCES `admin_accounts`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `team_catalog_sync_items` (
    `id` CHAR(36) NOT NULL,
    `run_id` CHAR(36) NOT NULL,
    `source_external_id` VARCHAR(128) NOT NULL,
    `summary_checksum` CHAR(64) NOT NULL,
    `detail_checksum` CHAR(64) NULL,
    `change_type` ENUM('ADDED', 'UPDATED', 'SOURCE_MISSING') NOT NULL,
    `review_status` ENUM('PENDING', 'PUBLISHED', 'REJECTED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `current_catalog_item_id` CHAR(36) NULL,
    `candidate_json` JSON NULL,
    `raw_detail` JSON NULL,
    `attempts` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `error_code` VARCHAR(128) NULL,
    `error_message` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `team_catalog_sync_items_run_source_unique`(`run_id`, `source_external_id`),
    INDEX `team_catalog_sync_items_review_idx`(`run_id`, `review_status`),
    INDEX `team_catalog_sync_items_source_idx`(`source_external_id`, `updated_at`),
    INDEX `team_catalog_sync_items_current_catalog_idx`(`current_catalog_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `team_catalog_sync_items`
    ADD CONSTRAINT `team_catalog_sync_items_run_fkey`
        FOREIGN KEY (`run_id`) REFERENCES `team_catalog_sync_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `team_catalog_sync_items_current_catalog_fkey`
        FOREIGN KEY (`current_catalog_item_id`) REFERENCES `team_catalog_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
