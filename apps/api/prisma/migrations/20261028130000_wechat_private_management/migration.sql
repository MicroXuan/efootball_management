-- AlterTable
ALTER TABLE `competition_matches` ADD COLUMN `advancement_reason` VARCHAR(512) NULL,
    ADD COLUMN `advancement_winner_participant_id` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `wechat_entity_references` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `kind` VARCHAR(16) NOT NULL,
    `entity_id` CHAR(36) NOT NULL,

    UNIQUE INDEX `wechat_entity_references_kind_entity_id_key`(`kind`, `entity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wechat_admin_operations` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(12) NOT NULL,
    `contact_id` CHAR(36) NOT NULL,
    `binding_version` INTEGER UNSIGNED NOT NULL,
    `inbound_id` CHAR(36) NOT NULL,
    `admin_id` CHAR(36) NOT NULL,
    `league_id` CHAR(36) NOT NULL,
    `season_id` CHAR(36) NOT NULL,
    `kind` VARCHAR(24) NOT NULL,
    `payload` JSON NOT NULL,
    `preview` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `result` TEXT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,

    UNIQUE INDEX `wechat_admin_operations_code_key`(`code`),
    UNIQUE INDEX `wechat_admin_operations_inbound_id_key`(`inbound_id`),
    INDEX `wechat_admin_operations_contact_id_status_idx`(`contact_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

