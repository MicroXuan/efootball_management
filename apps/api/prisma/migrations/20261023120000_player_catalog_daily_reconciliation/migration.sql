-- AlterTable
ALTER TABLE `player_cards` ADD COLUMN `last_detail_audit_at` DATETIME(3) NULL,
    ADD COLUMN `published_summary_checksum` CHAR(64) NULL;

-- AlterTable
ALTER TABLE `external_sync_runs` ADD COLUMN `business_date` DATE NULL,
    ADD COLUMN `scan_trusted` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `schedule_key` VARCHAR(96) NULL,
    MODIFY `mode` ENUM('SAMPLE', 'FULL', 'INCREMENTAL', 'RECONCILE') NOT NULL;

-- CreateTable
CREATE TABLE `player_catalog_scan_pages` (
    `run_id` CHAR(36) NOT NULL,
    `pass` TINYINT UNSIGNED NOT NULL,
    `offset` INTEGER UNSIGNED NOT NULL,
    `page_limit` INTEGER UNSIGNED NOT NULL,
    `reported_total` INTEGER UNSIGNED NOT NULL,
    `returned_count` INTEGER UNSIGNED NOT NULL,
    `id_checksum` CHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`run_id`, `pass`, `offset`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `player_catalog_scan_entries` (
    `run_id` CHAR(36) NOT NULL,
    `pass` TINYINT UNSIGNED NOT NULL,
    `external_id` VARCHAR(128) NOT NULL,
    `summary_checksum` CHAR(64) NOT NULL,
    `display_name` VARCHAR(255) NULL,

    INDEX `player_catalog_scan_entries_run_id_idx`(`run_id`, `external_id`),
    PRIMARY KEY (`run_id`, `pass`, `external_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `player_catalog_reconciliation_items` (
    `id` CHAR(36) NOT NULL,
    `run_id` CHAR(36) NOT NULL,
    `external_id` VARCHAR(128) NOT NULL,
    `change_type` VARCHAR(32) NOT NULL,
    `reason` VARCHAR(512) NULL,
    `summary_checksum` CHAR(64) NULL,
    `display_name` VARCHAR(255) NULL,
    `normalized_json` JSON NULL,
    `evidence_json` JSON NULL,
    `batch_id` CHAR(36) NULL,
    `published_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `player_catalog_reconciliation_items_run_type_idx`(`run_id`, `change_type`),
    UNIQUE INDEX `player_catalog_reconciliation_items_run_id_unique`(`run_id`, `external_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `player_catalog_sync_schedules` (
    `source_id` CHAR(36) NOT NULL,
    `actor_id` CHAR(36) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `time_zone` VARCHAR(64) NOT NULL,
    `local_time` VARCHAR(5) NOT NULL,
    `last_triggered_date` CHAR(10) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`source_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `external_sync_runs_schedule_key_key` ON `external_sync_runs`(`schedule_key`);

-- CreateIndex
CREATE INDEX `external_sync_runs_trusted_day_idx` ON `external_sync_runs`(`source_id`, `business_date`, `scan_trusted`);

-- AddForeignKey
ALTER TABLE `player_catalog_scan_pages` ADD CONSTRAINT `player_catalog_scan_pages_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `external_sync_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_catalog_scan_entries` ADD CONSTRAINT `player_catalog_scan_entries_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `external_sync_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_catalog_reconciliation_items` ADD CONSTRAINT `player_catalog_reconciliation_items_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `external_sync_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
