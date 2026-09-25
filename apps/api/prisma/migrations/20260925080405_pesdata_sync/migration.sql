-- CreateTable
CREATE TABLE `external_sync_runs` (
    `id` CHAR(36) NOT NULL,
    `source_id` CHAR(36) NOT NULL,
    `actor_id` CHAR(36) NOT NULL,
    `mode` ENUM('SAMPLE', 'FULL', 'INCREMENTAL') NOT NULL,
    `status` ENUM('PENDING', 'RUNNING', 'READY', 'PAUSED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `active_lease_key` VARCHAR(64) NULL,
    `requested_limit` INTEGER UNSIGNED NULL,
    `source_total` INTEGER UNSIGNED NULL,
    `scanned_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `fetched_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `skipped_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `failed_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `current_offset` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `error_code` VARCHAR(64) NULL,
    `error_message` VARCHAR(512) NULL,
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `external_sync_runs_active_lease_key_key`(`active_lease_key`),
    INDEX `external_sync_runs_source_status_idx`(`source_id`, `status`, `created_at`),
    INDEX `external_sync_runs_actor_idx`(`actor_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `external_sync_items` (
    `id` CHAR(36) NOT NULL,
    `run_id` CHAR(36) NOT NULL,
    `external_id` VARCHAR(128) NOT NULL,
    `summary_checksum` CHAR(64) NOT NULL,
    `detail_checksum` CHAR(64) NULL,
    `status` ENUM('PENDING', 'FETCHED', 'SKIPPED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `raw_detail` JSON NULL,
    `normalized_json` JSON NULL,
    `attempts` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `last_error` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `external_sync_items_run_status_idx`(`run_id`, `status`),
    INDEX `external_sync_items_external_updated_idx`(`external_id`, `updated_at`),
    UNIQUE INDEX `external_sync_items_run_external_unique`(`run_id`, `external_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `external_sync_run_batches` (
    `run_id` CHAR(36) NOT NULL,
    `batch_id` CHAR(36) NOT NULL,
    `chunk_index` INTEGER UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `external_sync_run_batches_batch_idx`(`batch_id`),
    UNIQUE INDEX `external_sync_run_batches_chunk_unique`(`run_id`, `chunk_index`),
    PRIMARY KEY (`run_id`, `batch_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `external_sync_runs` ADD CONSTRAINT `external_sync_runs_source_id_fkey` FOREIGN KEY (`source_id`) REFERENCES `data_sources`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `external_sync_items` ADD CONSTRAINT `external_sync_items_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `external_sync_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `external_sync_run_batches` ADD CONSTRAINT `external_sync_run_batches_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `external_sync_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `external_sync_run_batches` ADD CONSTRAINT `external_sync_run_batches_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
