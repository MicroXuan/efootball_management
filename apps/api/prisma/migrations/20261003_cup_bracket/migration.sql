CREATE TABLE `cup_bracket_proposals` (
    `id` CHAR(36) NOT NULL,
    `competition_id` CHAR(36) NOT NULL,
    `version` INTEGER UNSIGNED NOT NULL,
    `status` ENUM('DRAFT', 'CONFIRMED', 'SUPERSEDED') NOT NULL DEFAULT 'DRAFT',
    `algorithm_version` VARCHAR(32) NOT NULL,
    `random_seed` INTEGER UNSIGNED NOT NULL,
    `bracket_size` SMALLINT UNSIGNED NOT NULL,
    `input_summary` JSON NULL,
    `created_by_admin_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `cup_bracket_proposals_version_unique`(`competition_id`, `version`),
    INDEX `cup_bracket_proposals_status_idx`(`competition_id`, `status`),
    INDEX `cup_bracket_proposals_creator_idx`(`created_by_admin_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `cup_bracket_rounds` (
    `id` CHAR(36) NOT NULL,
    `proposal_id` CHAR(36) NOT NULL,
    `round_number` SMALLINT UNSIGNED NOT NULL,
    `stage_code` VARCHAR(32) NOT NULL,
    `display_name` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `cup_bracket_rounds_number_unique`(`proposal_id`, `round_number`),
    UNIQUE INDEX `cup_bracket_rounds_stage_unique`(`proposal_id`, `stage_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `cup_bracket_pairings` (
    `id` CHAR(36) NOT NULL,
    `round_id` CHAR(36) NOT NULL,
    `pairing_number` SMALLINT UNSIGNED NOT NULL,
    `home_participant_id` CHAR(36) NULL,
    `away_participant_id` CHAR(36) NULL,
    `home_source_pairing_id` CHAR(36) NULL,
    `away_source_pairing_id` CHAR(36) NULL,
    `bye_participant_id` CHAR(36) NULL,
    `match_id` CHAR(36) NULL,
    `winner_participant_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `cup_bracket_pairings_match_id_key`(`match_id`),
    UNIQUE INDEX `cup_bracket_pairings_number_unique`(`round_id`, `pairing_number`),
    INDEX `cup_bracket_pairings_home_idx`(`home_participant_id`),
    INDEX `cup_bracket_pairings_away_idx`(`away_participant_id`),
    INDEX `cup_bracket_pairings_home_source_idx`(`home_source_pairing_id`),
    INDEX `cup_bracket_pairings_away_source_idx`(`away_source_pairing_id`),
    INDEX `cup_bracket_pairings_bye_idx`(`bye_participant_id`),
    INDEX `cup_bracket_pairings_winner_idx`(`winner_participant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `cup_bracket_proposals`
    ADD CONSTRAINT `cup_bracket_proposals_competition_id_fkey`
    FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `cup_bracket_proposals_created_by_admin_id_fkey`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admin_accounts`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `cup_bracket_rounds`
    ADD CONSTRAINT `cup_bracket_rounds_proposal_id_fkey`
    FOREIGN KEY (`proposal_id`) REFERENCES `cup_bracket_proposals`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `cup_bracket_pairings`
    ADD CONSTRAINT `cup_bracket_pairings_round_id_fkey`
    FOREIGN KEY (`round_id`) REFERENCES `cup_bracket_rounds`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `cup_bracket_pairings_home_participant_id_fkey`
    FOREIGN KEY (`home_participant_id`) REFERENCES `competition_participants`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `cup_bracket_pairings_away_participant_id_fkey`
    FOREIGN KEY (`away_participant_id`) REFERENCES `competition_participants`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `cup_bracket_pairings_home_source_pairing_id_fkey`
    FOREIGN KEY (`home_source_pairing_id`) REFERENCES `cup_bracket_pairings`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `cup_bracket_pairings_away_source_pairing_id_fkey`
    FOREIGN KEY (`away_source_pairing_id`) REFERENCES `cup_bracket_pairings`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `cup_bracket_pairings_bye_participant_id_fkey`
    FOREIGN KEY (`bye_participant_id`) REFERENCES `competition_participants`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `cup_bracket_pairings_match_id_fkey`
    FOREIGN KEY (`match_id`) REFERENCES `competition_matches`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `cup_bracket_pairings_winner_participant_id_fkey`
    FOREIGN KEY (`winner_participant_id`) REFERENCES `competition_participants`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
