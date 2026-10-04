ALTER TABLE `finance_ledger_entries`
    ADD COLUMN `season_id` CHAR(36) NULL,
    MODIFY `type` ENUM(
        'PLAYER_PURCHASE', 'PLAYER_SALE', 'PLAYER_TRANSFER', 'CARD_UPGRADE',
        'TRANSACTION_FEE', 'LUXURY_TAX', 'OFFSEASON_FEE',
        'UNFINISHED_MATCH_PENALTY', 'AUCTION', 'ROOKIE_SELECTION',
        'INSTALLMENT_PAYMENT', 'MANUAL_ADJUSTMENT'
    ) NOT NULL;

ALTER TABLE `league_player_ownerships`
    MODIFY `status` ENUM('ACTIVE', 'RELEASED', 'TRANSFERRED', 'DISAPPEARED', 'RETIRED')
    NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE `league_teams`
    ADD COLUMN `shell_value_minor` INTEGER UNSIGNED NOT NULL DEFAULT 0;

ALTER TABLE `roster_transactions`
    ADD COLUMN `transaction_fee_minor` INTEGER UNSIGNED NULL,
    ADD COLUMN `transaction_fee_rule_version_id` CHAR(36) NULL,
    ADD COLUMN `valuation_snapshot_minor` INTEGER UNSIGNED NULL;

CREATE TABLE `valuation_windows` (
    `id` CHAR(36) NOT NULL,
    `season_id` CHAR(36) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `starts_at` DATETIME(3) NOT NULL,
    `ends_at` DATETIME(3) NOT NULL,
    `closed_at` DATETIME(3) NULL,
    `current_rule_version_id` CHAR(36) NULL,
    `created_by_admin_id` CHAR(36) NOT NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `valuation_windows_current_rule_version_id_key`(`current_rule_version_id`),
    INDEX `valuation_windows_season_timeline_idx`(`season_id`, `starts_at`, `ends_at`),
    INDEX `valuation_windows_creator_idx`(`created_by_admin_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `valuation_window_rule_versions` (
    `id` CHAR(36) NOT NULL,
    `window_id` CHAR(36) NOT NULL,
    `version` INTEGER UNSIGNED NOT NULL,
    `minimum_value_minor` INTEGER UNSIGNED NOT NULL,
    `maximum_value_minor` INTEGER UNSIGNED NOT NULL,
    `maximum_increase_bps` SMALLINT UNSIGNED NOT NULL,
    `maximum_decrease_bps` SMALLINT UNSIGNED NOT NULL,
    `created_by_admin_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `valuation_window_rule_versions_creator_idx`(`created_by_admin_id`),
    UNIQUE INDEX `valuation_window_rule_versions_unique`(`window_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `valuation_roster_snapshots` (
    `id` CHAR(36) NOT NULL,
    `window_id` CHAR(36) NOT NULL,
    `league_team_id` CHAR(36) NOT NULL,
    `ownership_id` CHAR(36) NOT NULL,
    `football_player_id` CHAR(36) NOT NULL,
    `base_value_minor` INTEGER UNSIGNED NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `valuation_roster_snapshots_team_idx`(`league_team_id`, `created_at`),
    INDEX `valuation_roster_snapshots_player_idx`(`football_player_id`),
    UNIQUE INDEX `valuation_roster_snapshots_ownership_unique`(`window_id`, `ownership_id`),
    UNIQUE INDEX `valuation_roster_snapshots_player_unique`(`window_id`, `league_team_id`, `football_player_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `valuation_submissions` (
    `id` CHAR(36) NOT NULL,
    `window_id` CHAR(36) NOT NULL,
    `league_team_id` CHAR(36) NOT NULL,
    `rule_version_id` CHAR(36) NOT NULL,
    `attempt_number` INTEGER UNSIGNED NOT NULL,
    `status` ENUM('DRAFT', 'PUBLISHED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'DRAFT',
    `submitted_by_user_id` CHAR(36) NOT NULL,
    `submitted_at` DATETIME(3) NULL,
    `reviewed_by_admin_id` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `review_reason` VARCHAR(512) NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    INDEX `valuation_submissions_window_status_idx`(`window_id`, `status`, `created_at`),
    INDEX `valuation_submissions_team_status_idx`(`league_team_id`, `status`, `created_at`),
    INDEX `valuation_submissions_rule_idx`(`rule_version_id`),
    INDEX `valuation_submissions_submitter_idx`(`submitted_by_user_id`),
    INDEX `valuation_submissions_reviewer_idx`(`reviewed_by_admin_id`),
    UNIQUE INDEX `valuation_submissions_attempt_unique`(`window_id`, `league_team_id`, `attempt_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `valuation_submission_items` (
    `id` CHAR(36) NOT NULL,
    `submission_id` CHAR(36) NOT NULL,
    `snapshot_id` CHAR(36) NOT NULL,
    `base_value_minor` INTEGER UNSIGNED NULL,
    `proposed_value_minor` INTEGER UNSIGNED NOT NULL,
    `minimum_allowed_minor` INTEGER UNSIGNED NOT NULL,
    `maximum_allowed_minor` INTEGER UNSIGNED NOT NULL,
    `exceeds_range` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    INDEX `valuation_submission_items_snapshot_idx`(`snapshot_id`),
    UNIQUE INDEX `valuation_submission_items_snapshot_unique`(`submission_id`, `snapshot_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `league_player_valuations` (
    `id` CHAR(36) NOT NULL,
    `league_id` CHAR(36) NOT NULL,
    `football_player_id` CHAR(36) NOT NULL,
    `current_value_minor` INTEGER UNSIGNED NOT NULL,
    `source_submission_id` CHAR(36) NULL,
    `effective_at` DATETIME(3) NOT NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    INDEX `league_player_valuations_submission_idx`(`source_submission_id`),
    UNIQUE INDEX `league_player_valuations_unique`(`league_id`, `football_player_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `player_valuation_history` (
    `id` CHAR(36) NOT NULL,
    `league_id` CHAR(36) NOT NULL,
    `football_player_id` CHAR(36) NOT NULL,
    `submission_id` CHAR(36) NOT NULL,
    `previous_value_minor` INTEGER UNSIGNED NULL,
    `new_value_minor` INTEGER UNSIGNED NOT NULL,
    `effective_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `player_valuation_history_timeline_idx`(`league_id`, `football_player_id`, `effective_at`),
    INDEX `player_valuation_history_submission_idx`(`submission_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `league_transaction_fee_rule_versions` (
    `id` CHAR(36) NOT NULL,
    `league_id` CHAR(36) NOT NULL,
    `version` INTEGER UNSIGNED NOT NULL,
    `rate_bps` SMALLINT UNSIGNED NOT NULL,
    `minimum_fee_minor` INTEGER UNSIGNED NOT NULL,
    `effective_at` DATETIME(3) NOT NULL,
    `created_by_admin_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `league_transaction_fee_rules_effective_idx`(`league_id`, `effective_at`),
    INDEX `league_transaction_fee_rules_creator_idx`(`created_by_admin_id`),
    UNIQUE INDEX `league_transaction_fee_rules_unique`(`league_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `finance_ledger_entries_season_team_idx`
    ON `finance_ledger_entries`(`season_id`, `league_team_id`, `created_at`);
CREATE INDEX `roster_transactions_fee_rule_idx`
    ON `roster_transactions`(`transaction_fee_rule_version_id`);

ALTER TABLE `roster_transactions` ADD CONSTRAINT `roster_transactions_transaction_fee_rule_version_id_fkey`
    FOREIGN KEY (`transaction_fee_rule_version_id`) REFERENCES `league_transaction_fee_rule_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `finance_ledger_entries` ADD CONSTRAINT `finance_ledger_entries_season_id_fkey`
    FOREIGN KEY (`season_id`) REFERENCES `league_seasons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `valuation_windows` ADD CONSTRAINT `valuation_windows_season_id_fkey`
    FOREIGN KEY (`season_id`) REFERENCES `league_seasons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `valuation_windows` ADD CONSTRAINT `valuation_windows_created_by_admin_id_fkey`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admin_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `valuation_windows` ADD CONSTRAINT `valuation_windows_current_rule_version_id_fkey`
    FOREIGN KEY (`current_rule_version_id`) REFERENCES `valuation_window_rule_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `valuation_window_rule_versions` ADD CONSTRAINT `valuation_window_rule_versions_window_id_fkey`
    FOREIGN KEY (`window_id`) REFERENCES `valuation_windows`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `valuation_window_rule_versions` ADD CONSTRAINT `valuation_window_rule_versions_created_by_admin_id_fkey`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admin_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `valuation_roster_snapshots` ADD CONSTRAINT `valuation_roster_snapshots_window_id_fkey`
    FOREIGN KEY (`window_id`) REFERENCES `valuation_windows`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `valuation_roster_snapshots` ADD CONSTRAINT `valuation_roster_snapshots_league_team_id_fkey`
    FOREIGN KEY (`league_team_id`) REFERENCES `league_teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `valuation_roster_snapshots` ADD CONSTRAINT `valuation_roster_snapshots_ownership_id_fkey`
    FOREIGN KEY (`ownership_id`) REFERENCES `league_player_ownerships`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `valuation_roster_snapshots` ADD CONSTRAINT `valuation_roster_snapshots_football_player_id_fkey`
    FOREIGN KEY (`football_player_id`) REFERENCES `football_players`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `valuation_submissions` ADD CONSTRAINT `valuation_submissions_window_id_fkey`
    FOREIGN KEY (`window_id`) REFERENCES `valuation_windows`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `valuation_submissions` ADD CONSTRAINT `valuation_submissions_league_team_id_fkey`
    FOREIGN KEY (`league_team_id`) REFERENCES `league_teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `valuation_submissions` ADD CONSTRAINT `valuation_submissions_rule_version_id_fkey`
    FOREIGN KEY (`rule_version_id`) REFERENCES `valuation_window_rule_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `valuation_submissions` ADD CONSTRAINT `valuation_submissions_submitted_by_user_id_fkey`
    FOREIGN KEY (`submitted_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `valuation_submissions` ADD CONSTRAINT `valuation_submissions_reviewed_by_admin_id_fkey`
    FOREIGN KEY (`reviewed_by_admin_id`) REFERENCES `admin_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `valuation_submission_items` ADD CONSTRAINT `valuation_submission_items_submission_id_fkey`
    FOREIGN KEY (`submission_id`) REFERENCES `valuation_submissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `valuation_submission_items` ADD CONSTRAINT `valuation_submission_items_snapshot_id_fkey`
    FOREIGN KEY (`snapshot_id`) REFERENCES `valuation_roster_snapshots`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `league_player_valuations` ADD CONSTRAINT `league_player_valuations_league_id_fkey`
    FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `league_player_valuations` ADD CONSTRAINT `league_player_valuations_football_player_id_fkey`
    FOREIGN KEY (`football_player_id`) REFERENCES `football_players`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `league_player_valuations` ADD CONSTRAINT `league_player_valuations_source_submission_id_fkey`
    FOREIGN KEY (`source_submission_id`) REFERENCES `valuation_submissions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `player_valuation_history` ADD CONSTRAINT `player_valuation_history_league_id_fkey`
    FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `player_valuation_history` ADD CONSTRAINT `player_valuation_history_football_player_id_fkey`
    FOREIGN KEY (`football_player_id`) REFERENCES `football_players`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `player_valuation_history` ADD CONSTRAINT `player_valuation_history_submission_id_fkey`
    FOREIGN KEY (`submission_id`) REFERENCES `valuation_submissions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `league_transaction_fee_rule_versions` ADD CONSTRAINT `league_transaction_fee_rule_versions_league_id_fkey`
    FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `league_transaction_fee_rule_versions` ADD CONSTRAINT `league_transaction_fee_rule_versions_created_by_admin_id_fkey`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admin_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
