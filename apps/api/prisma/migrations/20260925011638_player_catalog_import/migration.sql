-- CreateTable
CREATE TABLE `data_sources` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `type` ENUM('MANUAL', 'API') NOT NULL DEFAULT 'MANUAL',
    `is_enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `data_sources_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `football_players` (
    `id` CHAR(36) NOT NULL,
    `name_zh` VARCHAR(128) NULL,
    `name_en` VARCHAR(128) NULL,
    `normalized_name_zh` VARCHAR(128) NULL,
    `normalized_name_en` VARCHAR(128) NULL,
    `short_name` VARCHAR(64) NULL,
    `nationality` VARCHAR(64) NULL,
    `club` VARCHAR(128) NULL,
    `published_at` DATETIME(3) NULL,
    `last_published_release_sequence` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `football_players_name_zh_idx`(`normalized_name_zh`),
    INDEX `football_players_name_en_idx`(`normalized_name_en`),
    INDEX `football_players_published_at_idx`(`published_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `football_player_sources` (
    `id` CHAR(36) NOT NULL,
    `player_id` CHAR(36) NOT NULL,
    `source_id` CHAR(36) NOT NULL,
    `external_id` VARCHAR(128) NOT NULL,
    `source_updated_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `football_player_sources_player_idx`(`player_id`),
    UNIQUE INDEX `football_player_sources_identity_unique`(`source_id`, `external_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `card_packs` (
    `id` CHAR(36) NOT NULL,
    `source_id` CHAR(36) NOT NULL,
    `external_id` VARCHAR(128) NOT NULL,
    `name_zh` VARCHAR(128) NULL,
    `name_en` VARCHAR(128) NULL,
    `season` VARCHAR(32) NULL,
    `release_date` DATE NULL,
    `cover_url` VARCHAR(2048) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `published_at` DATETIME(3) NULL,
    `last_published_release_sequence` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `card_packs_published_status_idx`(`published_at`, `status`),
    UNIQUE INDEX `card_packs_identity_unique`(`source_id`, `external_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `player_cards` (
    `id` CHAR(36) NOT NULL,
    `source_id` CHAR(36) NOT NULL,
    `external_id` VARCHAR(128) NOT NULL,
    `player_id` CHAR(36) NOT NULL,
    `card_pack_id` CHAR(36) NULL,
    `card_name` VARCHAR(128) NOT NULL,
    `position` ENUM('GK', 'CB', 'LB', 'RB', 'DMF', 'CMF', 'LMF', 'RMF', 'AMF', 'LWF', 'RWF', 'SS', 'CF') NOT NULL,
    `overall_rating` TINYINT UNSIGNED NOT NULL,
    `card_type` ENUM('STANDARD', 'FEATURED', 'TRENDING', 'HIGHLIGHT', 'EPIC', 'BIG_TIME', 'OTHER') NOT NULL,
    `play_style` VARCHAR(128) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `image_url` VARCHAR(2048) NULL,
    `source_updated_at` DATETIME(3) NULL,
    `published_at` DATETIME(3) NULL,
    `last_published_release_sequence` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `player_cards_filter_idx`(`position`, `card_type`, `overall_rating`),
    INDEX `player_cards_pack_idx`(`card_pack_id`),
    INDEX `player_cards_published_status_idx`(`published_at`, `status`),
    UNIQUE INDEX `player_cards_identity_unique`(`source_id`, `external_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `player_card_attributes` (
    `id` CHAR(36) NOT NULL,
    `player_card_id` CHAR(36) NOT NULL,
    `attributes_json` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `player_card_attributes_player_card_id_key`(`player_card_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skills` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(128) NOT NULL,
    `name_zh` VARCHAR(128) NULL,
    `name_en` VARCHAR(128) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `skills_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `player_card_skills` (
    `player_card_id` CHAR(36) NOT NULL,
    `skill_id` CHAR(36) NOT NULL,

    PRIMARY KEY (`player_card_id`, `skill_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_batches` (
    `id` CHAR(36) NOT NULL,
    `source_id` CHAR(36) NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `format` ENUM('CSV', 'JSON') NOT NULL,
    `checksum` CHAR(64) NOT NULL,
    `status` ENUM('UPLOADED', 'VALIDATED', 'READY', 'PUBLISHED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'UPLOADED',
    `total_count` INTEGER NOT NULL DEFAULT 0,
    `create_count` INTEGER NOT NULL DEFAULT 0,
    `update_count` INTEGER NOT NULL DEFAULT 0,
    `unchanged_count` INTEGER NOT NULL DEFAULT 0,
    `invalid_count` INTEGER NOT NULL DEFAULT 0,
    `failure_reason` VARCHAR(512) NULL,
    `created_by` CHAR(36) NOT NULL,
    `published_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `import_batches_status_created_idx`(`status`, `created_at`),
    UNIQUE INDEX `import_batches_source_checksum_unique`(`source_id`, `checksum`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_records` (
    `id` CHAR(36) NOT NULL,
    `batch_id` CHAR(36) NOT NULL,
    `row_number` INTEGER NOT NULL,
    `external_id` VARCHAR(128) NULL,
    `content_checksum` CHAR(64) NULL,
    `raw_json` JSON NOT NULL,
    `normalized_json` JSON NULL,
    `diff_type` ENUM('CREATE', 'UPDATE', 'UNCHANGED', 'INVALID') NOT NULL,
    `field_diff` JSON NOT NULL,
    `validation_errors` JSON NOT NULL,
    `target_player_id` CHAR(36) NULL,
    `target_card_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `import_records_batch_diff_idx`(`batch_id`, `diff_type`),
    INDEX `import_records_target_player_idx`(`target_player_id`),
    INDEX `import_records_target_card_idx`(`target_card_id`),
    UNIQUE INDEX `import_records_batch_row_unique`(`batch_id`, `row_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `catalog_releases` (
    `id` CHAR(36) NOT NULL,
    `sequence` INTEGER NOT NULL AUTO_INCREMENT,
    `batch_id` CHAR(36) NOT NULL,
    `published_by` CHAR(36) NOT NULL,
    `created_count` INTEGER NOT NULL,
    `updated_count` INTEGER NOT NULL,
    `unchanged_count` INTEGER NOT NULL,
    `published_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `catalog_releases_sequence_key`(`sequence`),
    UNIQUE INDEX `catalog_releases_batch_id_key`(`batch_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `player_card_versions` (
    `id` CHAR(36) NOT NULL,
    `player_card_id` CHAR(36) NOT NULL,
    `release_sequence` INTEGER NOT NULL,
    `player_id` CHAR(36) NOT NULL,
    `player_name_zh` VARCHAR(128) NULL,
    `player_name_en` VARCHAR(128) NULL,
    `normalized_name_zh` VARCHAR(128) NULL,
    `normalized_name_en` VARCHAR(128) NULL,
    `player_short_name` VARCHAR(64) NULL,
    `nationality` VARCHAR(64) NULL,
    `club` VARCHAR(128) NULL,
    `card_pack_id` CHAR(36) NULL,
    `pack_name_zh` VARCHAR(128) NULL,
    `pack_name_en` VARCHAR(128) NULL,
    `pack_season` VARCHAR(32) NULL,
    `pack_release_date` DATE NULL,
    `pack_cover_url` VARCHAR(2048) NULL,
    `card_name` VARCHAR(128) NOT NULL,
    `position` ENUM('GK', 'CB', 'LB', 'RB', 'DMF', 'CMF', 'LMF', 'RMF', 'AMF', 'LWF', 'RWF', 'SS', 'CF') NOT NULL,
    `overall_rating` TINYINT UNSIGNED NOT NULL,
    `card_type` ENUM('STANDARD', 'FEATURED', 'TRENDING', 'HIGHLIGHT', 'EPIC', 'BIG_TIME', 'OTHER') NOT NULL,
    `play_style` VARCHAR(128) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL,
    `image_url` VARCHAR(2048) NULL,
    `source_updated_at` DATETIME(3) NULL,
    `skills_json` JSON NOT NULL,
    `attributes_json` JSON NOT NULL,
    `published_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `player_card_versions_release_status_idx`(`release_sequence`, `status`),
    INDEX `player_card_versions_filter_idx`(`position`, `card_type`, `overall_rating`),
    INDEX `player_card_versions_name_zh_idx`(`normalized_name_zh`),
    INDEX `player_card_versions_name_en_idx`(`normalized_name_en`),
    UNIQUE INDEX `player_card_versions_card_release_unique`(`player_card_id`, `release_sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `football_player_sources` ADD CONSTRAINT `football_player_sources_player_id_fkey` FOREIGN KEY (`player_id`) REFERENCES `football_players`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `football_player_sources` ADD CONSTRAINT `football_player_sources_source_id_fkey` FOREIGN KEY (`source_id`) REFERENCES `data_sources`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `card_packs` ADD CONSTRAINT `card_packs_source_id_fkey` FOREIGN KEY (`source_id`) REFERENCES `data_sources`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_cards` ADD CONSTRAINT `player_cards_source_id_fkey` FOREIGN KEY (`source_id`) REFERENCES `data_sources`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_cards` ADD CONSTRAINT `player_cards_player_id_fkey` FOREIGN KEY (`player_id`) REFERENCES `football_players`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_cards` ADD CONSTRAINT `player_cards_card_pack_id_fkey` FOREIGN KEY (`card_pack_id`) REFERENCES `card_packs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_card_attributes` ADD CONSTRAINT `player_card_attributes_player_card_id_fkey` FOREIGN KEY (`player_card_id`) REFERENCES `player_cards`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_card_skills` ADD CONSTRAINT `player_card_skills_player_card_id_fkey` FOREIGN KEY (`player_card_id`) REFERENCES `player_cards`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_card_skills` ADD CONSTRAINT `player_card_skills_skill_id_fkey` FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_batches` ADD CONSTRAINT `import_batches_source_id_fkey` FOREIGN KEY (`source_id`) REFERENCES `data_sources`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_records` ADD CONSTRAINT `import_records_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_records` ADD CONSTRAINT `import_records_target_player_id_fkey` FOREIGN KEY (`target_player_id`) REFERENCES `football_players`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_records` ADD CONSTRAINT `import_records_target_card_id_fkey` FOREIGN KEY (`target_card_id`) REFERENCES `player_cards`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `catalog_releases` ADD CONSTRAINT `catalog_releases_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_card_versions` ADD CONSTRAINT `player_card_versions_player_card_id_fkey` FOREIGN KEY (`player_card_id`) REFERENCES `player_cards`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_card_versions` ADD CONSTRAINT `player_card_versions_release_sequence_fkey` FOREIGN KEY (`release_sequence`) REFERENCES `catalog_releases`(`sequence`) ON DELETE RESTRICT ON UPDATE CASCADE;
