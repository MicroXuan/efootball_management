CREATE TABLE `platform_presentations` (
    `id` VARCHAR(32) NOT NULL,
    `league_center_banner_url` VARCHAR(2048) NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
