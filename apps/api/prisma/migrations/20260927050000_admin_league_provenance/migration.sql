ALTER TABLE `leagues`
    MODIFY `created_by_id` CHAR(36) NULL,
    ADD COLUMN `created_by_admin_id` CHAR(36) NULL;

CREATE INDEX `leagues_admin_creator_idx` ON `leagues`(`created_by_admin_id`);

ALTER TABLE `leagues` ADD CONSTRAINT `leagues_created_by_admin_id_fkey`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admin_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `admin_mutation_receipts` (
    `id` CHAR(36) NOT NULL,
    `admin_id` CHAR(36) NOT NULL,
    `operation` VARCHAR(96) NOT NULL,
    `key` VARCHAR(128) NOT NULL,
    `result_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `admin_mutation_receipts_request_unique`(`admin_id`, `operation`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `admin_mutation_receipts` ADD CONSTRAINT `admin_mutation_receipts_admin_id_fkey`
    FOREIGN KEY (`admin_id`) REFERENCES `admin_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
