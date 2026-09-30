CREATE TABLE `roster_transactions` (
    `id` CHAR(36) NOT NULL,
    `league_id` CHAR(36) NOT NULL,
    `season_id` CHAR(36) NOT NULL,
    `type` ENUM('BUY', 'SELL', 'RELEASE', 'TRANSFER', 'CARD_UPGRADE', 'SALARY_RECALCULATION', 'EMERGENCY_CORRECTION') NOT NULL,
    `football_player_id` CHAR(36) NOT NULL,
    `source_league_team_id` CHAR(36) NULL,
    `target_league_team_id` CHAR(36) NULL,
    `old_player_card_id` CHAR(36) NULL,
    `new_player_card_id` CHAR(36) NULL,
    `old_salary_minor` INT UNSIGNED NULL,
    `new_salary_minor` INT UNSIGNED NULL,
    `amount_minor` INT UNSIGNED NULL,
    `reason` VARCHAR(512) NOT NULL,
    `created_by_admin_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `roster_transactions_league_timeline_idx`(`league_id`, `created_at`, `id`),
    INDEX `roster_transactions_season_type_idx`(`season_id`, `type`),
    INDEX `roster_transactions_player_idx`(`football_player_id`),
    INDEX `roster_transactions_source_team_idx`(`source_league_team_id`),
    INDEX `roster_transactions_target_team_idx`(`target_league_team_id`),
    INDEX `roster_transactions_old_card_idx`(`old_player_card_id`),
    INDEX `roster_transactions_new_card_idx`(`new_player_card_id`),
    INDEX `roster_transactions_creator_idx`(`created_by_admin_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `finance_ledger_entries` (
    `id` CHAR(36) NOT NULL,
    `league_id` CHAR(36) NOT NULL,
    `league_team_id` CHAR(36) NOT NULL,
    `roster_transaction_id` CHAR(36) NULL,
    `direction` ENUM('DEBIT', 'CREDIT') NOT NULL,
    `type` ENUM('PLAYER_PURCHASE', 'PLAYER_SALE', 'PLAYER_TRANSFER', 'CARD_UPGRADE', 'MANUAL_ADJUSTMENT') NOT NULL,
    `amount_minor` INT UNSIGNED NOT NULL,
    `note` VARCHAR(512) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `finance_ledger_entries_league_timeline_idx`(`league_id`, `created_at`, `id`),
    INDEX `finance_ledger_entries_team_timeline_idx`(`league_team_id`, `created_at`, `id`),
    INDEX `finance_ledger_entries_transaction_idx`(`roster_transaction_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `roster_transactions`
  ADD CONSTRAINT `roster_transactions_league_id_fkey` FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `roster_transactions_season_id_fkey` FOREIGN KEY (`season_id`) REFERENCES `league_seasons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `roster_transactions_football_player_id_fkey` FOREIGN KEY (`football_player_id`) REFERENCES `football_players`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `roster_transactions_source_league_team_id_fkey` FOREIGN KEY (`source_league_team_id`) REFERENCES `league_teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `roster_transactions_target_league_team_id_fkey` FOREIGN KEY (`target_league_team_id`) REFERENCES `league_teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `roster_transactions_old_player_card_id_fkey` FOREIGN KEY (`old_player_card_id`) REFERENCES `player_cards`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `roster_transactions_new_player_card_id_fkey` FOREIGN KEY (`new_player_card_id`) REFERENCES `player_cards`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `roster_transactions_created_by_admin_id_fkey` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admin_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `finance_ledger_entries`
  ADD CONSTRAINT `finance_ledger_entries_league_id_fkey` FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `finance_ledger_entries_league_team_id_fkey` FOREIGN KEY (`league_team_id`) REFERENCES `league_teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `finance_ledger_entries_roster_transaction_id_fkey` FOREIGN KEY (`roster_transaction_id`) REFERENCES `roster_transactions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
