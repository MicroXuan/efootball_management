-- Allow team cup registrations to use a formal season entry instead of an individual game account.
ALTER TABLE `competition_registrations`
    MODIFY `game_account_id` CHAR(36) NULL,
    ADD COLUMN `season_entry_id` CHAR(36) NULL;

CREATE UNIQUE INDEX `competition_registrations_season_entry_unique`
    ON `competition_registrations`(`competition_id`, `season_entry_id`);
CREATE INDEX `competition_registrations_season_entry_idx`
    ON `competition_registrations`(`season_entry_id`);

ALTER TABLE `competition_registrations`
    ADD CONSTRAINT `competition_registrations_season_entry_id_fkey`
    FOREIGN KEY (`season_entry_id`) REFERENCES `season_entries`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- A season entry can participate in its division competition and multiple cups.
DROP INDEX `competition_participants_season_entry_id_key` ON `competition_participants`;
CREATE UNIQUE INDEX `competition_participants_season_entry_unique`
    ON `competition_participants`(`competition_id`, `season_entry_id`);

CREATE TABLE `cup_competition_configs` (
    `id` CHAR(36) NOT NULL,
    `competition_id` CHAR(36) NOT NULL,
    `target_group_size` SMALLINT UNSIGNED NULL,
    `qualifiers_per_group` SMALLINT UNSIGNED NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `cup_competition_configs_competition_id_key`(`competition_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `cup_competition_configs`
    ADD CONSTRAINT `cup_competition_configs_competition_id_fkey`
    FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- League administrators create rules for season-bound competitions.
ALTER TABLE `competition_rule_versions`
    MODIFY `created_by_id` CHAR(36) NULL,
    ADD COLUMN `created_by_admin_id` CHAR(36) NULL;

CREATE INDEX `competition_rule_versions_admin_creator_idx`
    ON `competition_rule_versions`(`created_by_admin_id`);

ALTER TABLE `competition_rule_versions`
    ADD CONSTRAINT `competition_rule_versions_created_by_admin_id_fkey`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admin_accounts`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `cup_group_proposals` (
    `id` CHAR(36) NOT NULL,
    `competition_id` CHAR(36) NOT NULL,
    `version` INTEGER UNSIGNED NOT NULL,
    `status` ENUM('DRAFT', 'CONFIRMED', 'SUPERSEDED') NOT NULL DEFAULT 'DRAFT',
    `algorithm_version` VARCHAR(32) NOT NULL,
    `random_seed` INTEGER UNSIGNED NOT NULL,
    `input_summary` JSON NULL,
    `created_by_admin_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `cup_group_proposals_version_unique`(`competition_id`, `version`),
    INDEX `cup_group_proposals_status_idx`(`competition_id`, `status`),
    INDEX `cup_group_proposals_creator_idx`(`created_by_admin_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `cup_group_proposal_rows` (
    `id` CHAR(36) NOT NULL,
    `proposal_id` CHAR(36) NOT NULL,
    `participant_id` CHAR(36) NOT NULL,
    `team_name` VARCHAR(64) NOT NULL,
    `suggested_group_code` VARCHAR(32) NOT NULL,
    `final_group_code` VARCHAR(32) NULL,
    `overridden` BOOLEAN NOT NULL DEFAULT false,
    `reason` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `cup_group_proposal_rows_participant_unique`(`proposal_id`, `participant_id`),
    INDEX `cup_group_proposal_rows_participant_idx`(`participant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `cup_group_proposals`
    ADD CONSTRAINT `cup_group_proposals_competition_id_fkey`
    FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `cup_group_proposals_created_by_admin_id_fkey`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admin_accounts`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `cup_group_proposal_rows`
    ADD CONSTRAINT `cup_group_proposal_rows_proposal_id_fkey`
    FOREIGN KEY (`proposal_id`) REFERENCES `cup_group_proposals`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `cup_group_proposal_rows_participant_id_fkey`
    FOREIGN KEY (`participant_id`) REFERENCES `competition_participants`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
