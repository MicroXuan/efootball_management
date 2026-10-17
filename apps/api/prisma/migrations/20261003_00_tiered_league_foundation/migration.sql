-- AlterTable: preserve legacy competitions while allowing season-owned competition aggregates.
ALTER TABLE `competitions`
    ADD COLUMN `season_id` CHAR(36) NULL,
    ADD COLUMN `competition_type` ENUM('OPEN_EVENT', 'DIVISION_LEAGUE', 'GROUP_KNOCKOUT_CUP', 'KNOCKOUT_CUP') NOT NULL DEFAULT 'OPEN_EVENT';

CREATE INDEX `competitions_season_type_idx` ON `competitions`(`season_id`, `competition_type`);

-- AlterTable: legacy participants still point at registrations; tiered participants point at season entries.
ALTER TABLE `competition_participants`
    MODIFY `registration_id` CHAR(36) NULL,
    ADD COLUMN `season_entry_id` CHAR(36) NULL;

CREATE UNIQUE INDEX `competition_participants_season_entry_id_key` ON `competition_participants`(`season_entry_id`);
CREATE INDEX `competition_participants_season_entry_idx` ON `competition_participants`(`season_entry_id`);

-- AlterTable: nullable metadata keeps historical default stages readable without a destructive backfill.
ALTER TABLE `competition_stages`
    ADD COLUMN `stage_code` VARCHAR(32) NULL,
    ADD COLUMN `display_name` VARCHAR(64) NULL,
    ADD COLUMN `capacity` SMALLINT UNSIGNED NULL;

CREATE UNIQUE INDEX `competition_stages_code_unique` ON `competition_stages`(`competition_id`, `stage_code`);

-- AlterTable: new snapshots can be isolated to a stage; legacy snapshots remain competition-wide.
ALTER TABLE `standings_snapshots`
    ADD COLUMN `stage_id` CHAR(36) NULL;

CREATE INDEX `standings_snapshots_stage_version_idx` ON `standings_snapshots`(`stage_id`, `version`);

-- CreateTable
CREATE TABLE `stage_participants` (
    `id` CHAR(36) NOT NULL,
    `stage_id` CHAR(36) NOT NULL,
    `participant_id` CHAR(36) NOT NULL,
    `seed` INTEGER UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `stage_participants_participant_idx`(`participant_id`),
    UNIQUE INDEX `stage_participants_member_unique`(`stage_id`, `participant_id`),
    UNIQUE INDEX `stage_participants_seed_unique`(`stage_id`, `seed`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `season_allocation_proposals` (
    `id` CHAR(36) NOT NULL,
    `season_id` CHAR(36) NOT NULL,
    `version` INTEGER UNSIGNED NOT NULL,
    `status` ENUM('DRAFT', 'CONFIRMED', 'SUPERSEDED') NOT NULL DEFAULT 'DRAFT',
    `algorithm_version` VARCHAR(32) NOT NULL,
    `random_seed` INTEGER UNSIGNED NOT NULL,
    `input_summary` JSON NULL,
    `created_by_admin_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `season_allocation_proposals_status_idx`(`season_id`, `status`),
    INDEX `season_allocation_proposals_creator_idx`(`created_by_admin_id`),
    UNIQUE INDEX `season_allocation_proposals_version_unique`(`season_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `season_allocation_proposal_rows` (
    `id` CHAR(36) NOT NULL,
    `proposal_id` CHAR(36) NOT NULL,
    `season_entry_id` CHAR(36) NOT NULL,
    `team_name` VARCHAR(64) NOT NULL,
    `suggested_stage_code` VARCHAR(32) NOT NULL,
    `source` ENUM('FIRST_SEASON', 'RETAINED', 'PROMOTED', 'RELEGATED', 'REPLACEMENT', 'CHAMPION_POOL', 'NEW_ENTRY') NOT NULL,
    `previous_rank` INTEGER UNSIGNED NULL,
    `points_per_match` DOUBLE NULL,
    `goal_difference_per_match` DOUBLE NULL,
    `goals_for_per_match` DOUBLE NULL,
    `tie_pending` BOOLEAN NOT NULL DEFAULT false,
    `reason` VARCHAR(512) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `season_allocation_rows_season_entry_idx`(`season_entry_id`),
    UNIQUE INDEX `season_allocation_rows_entry_unique`(`proposal_id`, `season_entry_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `season_allocation_decisions` (
    `id` CHAR(36) NOT NULL,
    `proposal_id` CHAR(36) NOT NULL,
    `season_entry_id` CHAR(36) NOT NULL,
    `final_stage_code` VARCHAR(32) NOT NULL,
    `overridden` BOOLEAN NOT NULL DEFAULT false,
    `reason` VARCHAR(512) NULL,
    `decided_by_admin_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `season_allocation_decisions_season_entry_idx`(`season_entry_id`),
    INDEX `season_allocation_decisions_admin_idx`(`decided_by_admin_id`),
    UNIQUE INDEX `season_allocation_decisions_entry_unique`(`proposal_id`, `season_entry_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `competitions` ADD CONSTRAINT `competitions_season_id_fkey` FOREIGN KEY (`season_id`) REFERENCES `league_seasons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `competition_participants` ADD CONSTRAINT `competition_participants_season_entry_id_fkey` FOREIGN KEY (`season_entry_id`) REFERENCES `season_entries`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `standings_snapshots` ADD CONSTRAINT `standings_snapshots_stage_id_fkey` FOREIGN KEY (`stage_id`) REFERENCES `competition_stages`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stage_participants` ADD CONSTRAINT `stage_participants_stage_id_fkey` FOREIGN KEY (`stage_id`) REFERENCES `competition_stages`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stage_participants` ADD CONSTRAINT `stage_participants_participant_id_fkey` FOREIGN KEY (`participant_id`) REFERENCES `competition_participants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `season_allocation_proposals` ADD CONSTRAINT `season_allocation_proposals_season_id_fkey` FOREIGN KEY (`season_id`) REFERENCES `league_seasons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `season_allocation_proposals` ADD CONSTRAINT `season_allocation_proposals_created_by_admin_id_fkey` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admin_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `season_allocation_proposal_rows` ADD CONSTRAINT `season_allocation_proposal_rows_proposal_id_fkey` FOREIGN KEY (`proposal_id`) REFERENCES `season_allocation_proposals`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `season_allocation_proposal_rows` ADD CONSTRAINT `season_allocation_proposal_rows_season_entry_id_fkey` FOREIGN KEY (`season_entry_id`) REFERENCES `season_entries`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `season_allocation_decisions` ADD CONSTRAINT `season_allocation_decisions_proposal_id_fkey` FOREIGN KEY (`proposal_id`) REFERENCES `season_allocation_proposals`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `season_allocation_decisions` ADD CONSTRAINT `season_allocation_decisions_season_entry_id_fkey` FOREIGN KEY (`season_entry_id`) REFERENCES `season_entries`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `season_allocation_decisions` ADD CONSTRAINT `season_allocation_decisions_decided_by_admin_id_fkey` FOREIGN KEY (`decided_by_admin_id`) REFERENCES `admin_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
