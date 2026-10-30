-- CreateTable
CREATE TABLE `wechat_admin_contacts` (
    `id` CHAR(36) NOT NULL,
    `device_id` CHAR(36) NOT NULL,
    `wechat_contact_id` VARCHAR(256) NOT NULL,
    `admin_id` CHAR(36) NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `bound_at` DATETIME(3) NULL,
    `last_observed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `league_id` CHAR(36) NULL,
    `season_id` CHAR(36) NULL,

    UNIQUE INDEX `wechat_admin_contacts_device_id_wechat_contact_id_key`(`device_id`, `wechat_contact_id`),
    UNIQUE INDEX `wechat_admin_contacts_device_id_admin_id_key`(`device_id`, `admin_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wechat_match_references` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `match_id` CHAR(36) NOT NULL,

    UNIQUE INDEX `wechat_match_references_match_id_key`(`match_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wechat_score_operations` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(12) NOT NULL,
    `contact_id` CHAR(36) NOT NULL,
    `binding_version` INTEGER UNSIGNED NOT NULL,
    `inbound_id` CHAR(36) NOT NULL,
    `admin_id` CHAR(36) NOT NULL,
    `match_id` CHAR(36) NOT NULL,
    `league_id` CHAR(36) NOT NULL,
    `expected_version` INTEGER UNSIGNED NOT NULL,
    `home_score` TINYINT UNSIGNED NOT NULL,
    `away_score` TINYINT UNSIGNED NOT NULL,
    `reason` VARCHAR(512) NOT NULL,
    `preview` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `result` TEXT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,

    UNIQUE INDEX `wechat_score_operations_code_key`(`code`),
    UNIQUE INDEX `wechat_score_operations_inbound_id_key`(`inbound_id`),
    INDEX `wechat_score_operations_contact_id_status_idx`(`contact_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `wechat_admin_contacts` ADD CONSTRAINT `wechat_admin_contacts_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `wechat_bot_devices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wechat_admin_contacts` ADD CONSTRAINT `wechat_admin_contacts_admin_id_fkey` FOREIGN KEY (`admin_id`) REFERENCES `admin_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wechat_match_references` ADD CONSTRAINT `wechat_match_references_match_id_fkey` FOREIGN KEY (`match_id`) REFERENCES `competition_matches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wechat_score_operations` ADD CONSTRAINT `wechat_score_operations_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES `wechat_admin_contacts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wechat_score_operations` ADD CONSTRAINT `wechat_score_operations_match_id_fkey` FOREIGN KEY (`match_id`) REFERENCES `competition_matches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

