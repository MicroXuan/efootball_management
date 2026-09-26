-- CreateTable
CREATE TABLE `competitions` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `description` TEXT NOT NULL,
    `platform` ENUM('MOBILE', 'PLAYSTATION', 'XBOX', 'STEAM') NOT NULL,
    `server_region` VARCHAR(32) NOT NULL,
    `participant_type` ENUM('INDIVIDUAL', 'TEAM') NOT NULL DEFAULT 'INDIVIDUAL',
    `format` ENUM('ROUND_ROBIN', 'DOUBLE_ROUND_ROBIN', 'SINGLE_ELIMINATION', 'GROUP_KNOCKOUT') NOT NULL DEFAULT 'ROUND_ROBIN',
    `status` ENUM('DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `registration_opens_at` DATETIME(3) NOT NULL,
    `registration_closes_at` DATETIME(3) NOT NULL,
    `starts_at` DATETIME(3) NOT NULL,
    `ends_at` DATETIME(3) NOT NULL,
    `participant_limit` INTEGER UNSIGNED NOT NULL,
    `created_by_id` CHAR(36) NOT NULL,
    `active_rule_version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `bound_rule_version` INTEGER UNSIGNED NULL,
    `cancellation_reason` VARCHAR(512) NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `competitions_public_list_idx`(`status`, `registration_opens_at`, `id`),
    INDEX `competitions_creator_idx`(`created_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `competition_rule_versions` (
    `id` CHAR(36) NOT NULL,
    `competition_id` CHAR(36) NOT NULL,
    `version` INTEGER UNSIGNED NOT NULL,
    `win_points` INTEGER NOT NULL DEFAULT 3,
    `draw_points` INTEGER NOT NULL DEFAULT 1,
    `loss_points` INTEGER NOT NULL DEFAULT 0,
    `tie_breakers` JSON NOT NULL,
    `created_by_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `competition_rule_versions_creator_idx`(`created_by_id`),
    UNIQUE INDEX `competition_rule_versions_version_unique`(`competition_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `competition_registrations` (
    `id` CHAR(36) NOT NULL,
    `competition_id` CHAR(36) NOT NULL,
    `applicant_id` CHAR(36) NOT NULL,
    `game_account_id` CHAR(36) NOT NULL,
    `accepted_rule_version` INTEGER UNSIGNED NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN') NOT NULL DEFAULT 'PENDING',
    `reviewed_by_id` CHAR(36) NULL,
    `review_reason` VARCHAR(512) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `withdrawn_at` DATETIME(3) NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `competition_registrations_review_idx`(`competition_id`, `status`, `created_at`),
    INDEX `competition_registrations_account_idx`(`game_account_id`),
    INDEX `competition_registrations_reviewer_idx`(`reviewed_by_id`),
    UNIQUE INDEX `competition_registrations_applicant_unique`(`competition_id`, `applicant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `competition_registration_status_history` (
    `id` CHAR(36) NOT NULL,
    `registration_id` CHAR(36) NOT NULL,
    `from_status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN') NULL,
    `to_status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN') NOT NULL,
    `actor_id` CHAR(36) NOT NULL,
    `reason` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `competition_registration_history_idx`(`registration_id`, `created_at`),
    INDEX `competition_registration_history_actor_idx`(`actor_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `competition_participants` (
    `id` CHAR(36) NOT NULL,
    `competition_id` CHAR(36) NOT NULL,
    `participant_type` ENUM('INDIVIDUAL', 'TEAM') NOT NULL DEFAULT 'INDIVIDUAL',
    `registration_id` CHAR(36) NOT NULL,
    `individual_user_id` CHAR(36) NULL,
    `team_id` CHAR(36) NULL,
    `admission_sequence` INTEGER UNSIGNED NOT NULL,
    `display_name_snapshot` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `competition_participants_registration_id_key`(`registration_id`),
    INDEX `competition_participants_user_idx`(`individual_user_id`),
    UNIQUE INDEX `competition_participants_sequence_unique`(`competition_id`, `admission_sequence`),
    UNIQUE INDEX `competition_participants_user_unique`(`competition_id`, `individual_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `competition_stages` (
    `id` CHAR(36) NOT NULL,
    `competition_id` CHAR(36) NOT NULL,
    `sequence` INTEGER UNSIGNED NOT NULL,
    `format` ENUM('ROUND_ROBIN', 'DOUBLE_ROUND_ROBIN', 'SINGLE_ELIMINATION', 'GROUP_KNOCKOUT') NOT NULL DEFAULT 'ROUND_ROBIN',
    `status` ENUM('DRAFT', 'PUBLISHED') NOT NULL DEFAULT 'DRAFT',
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `published_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `competition_stages_status_idx`(`competition_id`, `status`),
    UNIQUE INDEX `competition_stages_sequence_unique`(`competition_id`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `competition_matches` (
    `id` CHAR(36) NOT NULL,
    `stage_id` CHAR(36) NOT NULL,
    `round_number` INTEGER UNSIGNED NOT NULL,
    `pairing_key` VARCHAR(73) NOT NULL,
    `match_number` INTEGER UNSIGNED NOT NULL,
    `home_participant_id` CHAR(36) NOT NULL,
    `away_participant_id` CHAR(36) NOT NULL,
    `planned_at` DATETIME(3) NULL,
    `status` ENUM('SCHEDULED', 'AWAITING_RESULT', 'PENDING_CONFIRMATION', 'CONFIRMED', 'ADMIN_DECIDED') NOT NULL DEFAULT 'SCHEDULED',
    `official_result_version_id` CHAR(36) NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `competition_matches_official_result_version_id_key`(`official_result_version_id`),
    INDEX `competition_matches_round_idx`(`stage_id`, `round_number`, `match_number`),
    INDEX `competition_matches_home_idx`(`home_participant_id`),
    INDEX `competition_matches_away_idx`(`away_participant_id`),
    UNIQUE INDEX `competition_matches_pair_unique`(`stage_id`, `pairing_key`),
    UNIQUE INDEX `competition_matches_number_unique`(`stage_id`, `match_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `match_result_versions` (
    `id` CHAR(36) NOT NULL,
    `match_id` CHAR(36) NOT NULL,
    `version` INTEGER UNSIGNED NOT NULL,
    `home_score` TINYINT UNSIGNED NOT NULL,
    `away_score` TINYINT UNSIGNED NOT NULL,
    `submitted_by_id` CHAR(36) NOT NULL,
    `submission_side` ENUM('HOME', 'AWAY', 'MANAGER') NOT NULL,
    `status` ENUM('PROPOSED', 'REJECTED', 'OFFICIAL', 'SUPERSEDED') NOT NULL DEFAULT 'PROPOSED',
    `reason` VARCHAR(512) NULL,
    `evidence_metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `match_result_versions_status_idx`(`match_id`, `status`),
    INDEX `match_result_versions_submitter_idx`(`submitted_by_id`),
    UNIQUE INDEX `match_result_versions_version_unique`(`match_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `standings_snapshots` (
    `id` CHAR(36) NOT NULL,
    `competition_id` CHAR(36) NOT NULL,
    `version` INTEGER UNSIGNED NOT NULL,
    `triggering_result_version_id` CHAR(36) NULL,
    `rule_version` INTEGER UNSIGNED NOT NULL,
    `generated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `standings_snapshots_trigger_idx`(`triggering_result_version_id`),
    UNIQUE INDEX `standings_snapshots_version_unique`(`competition_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `standings_rows` (
    `id` CHAR(36) NOT NULL,
    `snapshot_id` CHAR(36) NOT NULL,
    `participant_id` CHAR(36) NOT NULL,
    `played` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `wins` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `draws` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `losses` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `goals_for` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `goals_against` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `goal_difference` INTEGER NOT NULL DEFAULT 0,
    `base_points` INTEGER NOT NULL DEFAULT 0,
    `adjustment_points` INTEGER NOT NULL DEFAULT 0,
    `total_points` INTEGER NOT NULL DEFAULT 0,
    `rank` INTEGER UNSIGNED NOT NULL,
    `tie_pending` BOOLEAN NOT NULL DEFAULT false,
    `tie_break_values` JSON NOT NULL,

    INDEX `standings_rows_rank_idx`(`snapshot_id`, `rank`),
    INDEX `standings_rows_participant_idx`(`participant_id`),
    UNIQUE INDEX `standings_rows_participant_unique`(`snapshot_id`, `participant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mutation_receipts` (
    `id` CHAR(36) NOT NULL,
    `actor_id` CHAR(36) NOT NULL,
    `operation` VARCHAR(96) NOT NULL,
    `key` VARCHAR(128) NOT NULL,
    `result_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `mutation_receipts_request_unique`(`actor_id`, `operation`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `competitions` ADD CONSTRAINT `competitions_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `competition_rule_versions` ADD CONSTRAINT `competition_rule_versions_competition_id_fkey` FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `competition_rule_versions` ADD CONSTRAINT `competition_rule_versions_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `competition_registrations` ADD CONSTRAINT `competition_registrations_competition_id_fkey` FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `competition_registrations` ADD CONSTRAINT `competition_registrations_applicant_id_fkey` FOREIGN KEY (`applicant_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `competition_registrations` ADD CONSTRAINT `competition_registrations_game_account_id_fkey` FOREIGN KEY (`game_account_id`) REFERENCES `game_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `competition_registrations` ADD CONSTRAINT `competition_registrations_reviewed_by_id_fkey` FOREIGN KEY (`reviewed_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `competition_registration_status_history` ADD CONSTRAINT `competition_registration_status_history_registration_id_fkey` FOREIGN KEY (`registration_id`) REFERENCES `competition_registrations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `competition_registration_status_history` ADD CONSTRAINT `competition_registration_status_history_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `competition_participants` ADD CONSTRAINT `competition_participants_competition_id_fkey` FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `competition_participants` ADD CONSTRAINT `competition_participants_registration_id_fkey` FOREIGN KEY (`registration_id`) REFERENCES `competition_registrations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `competition_participants` ADD CONSTRAINT `competition_participants_individual_user_id_fkey` FOREIGN KEY (`individual_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `competition_stages` ADD CONSTRAINT `competition_stages_competition_id_fkey` FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `competition_matches` ADD CONSTRAINT `competition_matches_stage_id_fkey` FOREIGN KEY (`stage_id`) REFERENCES `competition_stages`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `competition_matches` ADD CONSTRAINT `competition_matches_home_participant_id_fkey` FOREIGN KEY (`home_participant_id`) REFERENCES `competition_participants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `competition_matches` ADD CONSTRAINT `competition_matches_away_participant_id_fkey` FOREIGN KEY (`away_participant_id`) REFERENCES `competition_participants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `competition_matches` ADD CONSTRAINT `competition_matches_official_result_version_id_fkey` FOREIGN KEY (`official_result_version_id`) REFERENCES `match_result_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_result_versions` ADD CONSTRAINT `match_result_versions_match_id_fkey` FOREIGN KEY (`match_id`) REFERENCES `competition_matches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_result_versions` ADD CONSTRAINT `match_result_versions_submitted_by_id_fkey` FOREIGN KEY (`submitted_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `standings_snapshots` ADD CONSTRAINT `standings_snapshots_competition_id_fkey` FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `standings_snapshots` ADD CONSTRAINT `standings_snapshots_triggering_result_version_id_fkey` FOREIGN KEY (`triggering_result_version_id`) REFERENCES `match_result_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `standings_rows` ADD CONSTRAINT `standings_rows_snapshot_id_fkey` FOREIGN KEY (`snapshot_id`) REFERENCES `standings_snapshots`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `standings_rows` ADD CONSTRAINT `standings_rows_participant_id_fkey` FOREIGN KEY (`participant_id`) REFERENCES `competition_participants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mutation_receipts` ADD CONSTRAINT `mutation_receipts_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
