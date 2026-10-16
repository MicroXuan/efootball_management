-- AlterTable
ALTER TABLE `leagues` ADD COLUMN `result_evidence_required` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `competition_matches` ADD COLUMN `result_confirmation_deadline_at` DATETIME(3) NULL,
    MODIFY `status` ENUM('SCHEDULED', 'AWAITING_RESULT', 'PENDING_CONFIRMATION', 'DISPUTED', 'CONFIRMED', 'ADMIN_DECIDED') NOT NULL DEFAULT 'SCHEDULED';

-- CreateTable
CREATE TABLE `match_result_disputes` (
    `id` CHAR(36) NOT NULL,
    `match_id` CHAR(36) NOT NULL,
    `trigger_result_version_id` CHAR(36) NOT NULL,
    `trigger` ENUM('REJECTED', 'CONFIRMATION_TIMEOUT') NOT NULL,
    `status` ENUM('EVIDENCE_COLLECTION', 'READY_FOR_REVIEW', 'RESOLVED', 'CANCELLED') NOT NULL DEFAULT 'EVIDENCE_COLLECTION',
    `active_key` CHAR(36) NULL,
    `opened_by_user_id` CHAR(36) NOT NULL,
    `evidence_deadline_at` DATETIME(3) NOT NULL,
    `decided_by_admin_id` CHAR(36) NULL,
    `decision_type` ENUM('USE_SUBMITTED_SCORE', 'REPLACE_SCORE') NULL,
    `final_home_score` TINYINT UNSIGNED NULL,
    `final_away_score` TINYINT UNSIGNED NULL,
    `decision_reason` VARCHAR(512) NULL,
    `decided_at` DATETIME(3) NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `match_result_disputes_active_key_unique`(`active_key`),
    INDEX `match_result_disputes_match_status_idx`(`match_id`, `status`),
    INDEX `match_result_disputes_status_deadline_idx`(`status`, `evidence_deadline_at`),
    INDEX `match_result_disputes_trigger_version_idx`(`trigger_result_version_id`),
    INDEX `match_result_disputes_opener_idx`(`opened_by_user_id`),
    INDEX `match_result_disputes_decider_idx`(`decided_by_admin_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `match_result_evidence_uploads` (
    `id` CHAR(36) NOT NULL,
    `match_id` CHAR(36) NOT NULL,
    `dispute_id` CHAR(36) NULL,
    `result_version_id` CHAR(36) NULL,
    `role` ENUM('SUBMITTER', 'OPPONENT', 'ADMIN') NOT NULL,
    `uploaded_by_user_id` CHAR(36) NULL,
    `uploaded_by_admin_id` CHAR(36) NULL,
    `object_key` VARCHAR(512) NOT NULL,
    `mime_type` VARCHAR(32) NOT NULL,
    `byte_size` INTEGER UNSIGNED NOT NULL,
    `checksum_sha256` CHAR(64) NOT NULL,
    `status` ENUM('PENDING', 'UPLOADED', 'CONSUMED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
    `expires_at` DATETIME(3) NOT NULL,
    `completed_at` DATETIME(3) NULL,
    `consumed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `match_result_evidence_uploads_object_key_unique`(`object_key`),
    INDEX `match_result_evidence_uploads_match_status_idx`(`match_id`, `status`),
    INDEX `match_result_evidence_uploads_expiry_idx`(`status`, `expires_at`),
    INDEX `match_result_evidence_uploads_dispute_idx`(`dispute_id`),
    INDEX `match_result_evidence_uploads_result_version_idx`(`result_version_id`),
    INDEX `match_result_evidence_uploads_user_idx`(`uploaded_by_user_id`),
    INDEX `match_result_evidence_uploads_admin_idx`(`uploaded_by_admin_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `match_result_evidence` (
    `id` CHAR(36) NOT NULL,
    `match_id` CHAR(36) NOT NULL,
    `dispute_id` CHAR(36) NULL,
    `result_version_id` CHAR(36) NULL,
    `upload_id` CHAR(36) NULL,
    `role` ENUM('SUBMITTER', 'OPPONENT', 'ADMIN') NOT NULL,
    `status` ENUM('ACTIVE', 'PENDING_DELETE', 'DELETED') NOT NULL DEFAULT 'ACTIVE',
    `uploaded_by_user_id` CHAR(36) NULL,
    `uploaded_by_admin_id` CHAR(36) NULL,
    `object_key` VARCHAR(512) NOT NULL,
    `mime_type` VARCHAR(32) NOT NULL,
    `byte_size` INTEGER UNSIGNED NOT NULL,
    `checksum_sha256` CHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `match_result_evidence_upload_id_unique`(`upload_id`),
    UNIQUE INDEX `match_result_evidence_object_key_unique`(`object_key`),
    INDEX `match_result_evidence_match_role_status_idx`(`match_id`, `role`, `status`),
    INDEX `match_result_evidence_dispute_role_status_idx`(`dispute_id`, `role`, `status`),
    INDEX `match_result_evidence_expiry_idx`(`status`, `expires_at`),
    INDEX `match_result_evidence_result_version_idx`(`result_version_id`),
    INDEX `match_result_evidence_user_idx`(`uploaded_by_user_id`),
    INDEX `match_result_evidence_admin_idx`(`uploaded_by_admin_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `match_result_events` (
    `id` CHAR(36) NOT NULL,
    `match_id` CHAR(36) NOT NULL,
    `dispute_id` CHAR(36) NULL,
    `result_version_id` CHAR(36) NULL,
    `type` ENUM('RESULT_SUBMITTED', 'RESULT_CONFIRMED', 'RESULT_REJECTED', 'CONFIRMATION_EXPIRED', 'DISPUTE_OPENED', 'EVIDENCE_UPLOADED', 'EVIDENCE_REPLACED', 'EVIDENCE_DEADLINE_EXPIRED', 'ADMIN_DECIDED', 'EVIDENCE_DELETED') NOT NULL,
    `event_key` VARCHAR(191) NOT NULL,
    `actor_type` ENUM('USER', 'ADMIN', 'SYSTEM') NOT NULL,
    `actor_user_id` CHAR(36) NULL,
    `actor_admin_id` CHAR(36) NULL,
    `metadata` JSON NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `match_result_events_event_key_unique`(`event_key`),
    INDEX `match_result_events_match_timeline_idx`(`match_id`, `occurred_at`, `id`),
    INDEX `match_result_events_dispute_timeline_idx`(`dispute_id`, `occurred_at`),
    INDEX `match_result_events_result_version_idx`(`result_version_id`),
    INDEX `match_result_events_actor_user_idx`(`actor_user_id`),
    INDEX `match_result_events_actor_admin_idx`(`actor_admin_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `competition_matches_confirmation_deadline_idx` ON `competition_matches`(`status`, `result_confirmation_deadline_at`);

-- AddForeignKey
ALTER TABLE `match_result_disputes` ADD CONSTRAINT `match_result_disputes_match_id_fkey` FOREIGN KEY (`match_id`) REFERENCES `competition_matches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_result_disputes` ADD CONSTRAINT `match_result_disputes_trigger_result_version_id_fkey` FOREIGN KEY (`trigger_result_version_id`) REFERENCES `match_result_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_result_disputes` ADD CONSTRAINT `match_result_disputes_opened_by_user_id_fkey` FOREIGN KEY (`opened_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_result_disputes` ADD CONSTRAINT `match_result_disputes_decided_by_admin_id_fkey` FOREIGN KEY (`decided_by_admin_id`) REFERENCES `admin_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_result_evidence_uploads` ADD CONSTRAINT `match_result_evidence_uploads_match_id_fkey` FOREIGN KEY (`match_id`) REFERENCES `competition_matches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_result_evidence_uploads` ADD CONSTRAINT `match_result_evidence_uploads_dispute_id_fkey` FOREIGN KEY (`dispute_id`) REFERENCES `match_result_disputes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_result_evidence_uploads` ADD CONSTRAINT `match_result_evidence_uploads_result_version_id_fkey` FOREIGN KEY (`result_version_id`) REFERENCES `match_result_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_result_evidence_uploads` ADD CONSTRAINT `match_result_evidence_uploads_uploaded_by_user_id_fkey` FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_result_evidence_uploads` ADD CONSTRAINT `match_result_evidence_uploads_uploaded_by_admin_id_fkey` FOREIGN KEY (`uploaded_by_admin_id`) REFERENCES `admin_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_result_evidence` ADD CONSTRAINT `match_result_evidence_match_id_fkey` FOREIGN KEY (`match_id`) REFERENCES `competition_matches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_result_evidence` ADD CONSTRAINT `match_result_evidence_dispute_id_fkey` FOREIGN KEY (`dispute_id`) REFERENCES `match_result_disputes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_result_evidence` ADD CONSTRAINT `match_result_evidence_result_version_id_fkey` FOREIGN KEY (`result_version_id`) REFERENCES `match_result_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_result_evidence` ADD CONSTRAINT `match_result_evidence_upload_id_fkey` FOREIGN KEY (`upload_id`) REFERENCES `match_result_evidence_uploads`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_result_evidence` ADD CONSTRAINT `match_result_evidence_uploaded_by_user_id_fkey` FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_result_evidence` ADD CONSTRAINT `match_result_evidence_uploaded_by_admin_id_fkey` FOREIGN KEY (`uploaded_by_admin_id`) REFERENCES `admin_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_result_events` ADD CONSTRAINT `match_result_events_match_id_fkey` FOREIGN KEY (`match_id`) REFERENCES `competition_matches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_result_events` ADD CONSTRAINT `match_result_events_dispute_id_fkey` FOREIGN KEY (`dispute_id`) REFERENCES `match_result_disputes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_result_events` ADD CONSTRAINT `match_result_events_result_version_id_fkey` FOREIGN KEY (`result_version_id`) REFERENCES `match_result_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_result_events` ADD CONSTRAINT `match_result_events_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_result_events` ADD CONSTRAINT `match_result_events_actor_admin_id_fkey` FOREIGN KEY (`actor_admin_id`) REFERENCES `admin_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
