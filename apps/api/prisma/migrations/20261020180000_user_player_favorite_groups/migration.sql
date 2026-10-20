CREATE TABLE `user_player_favorite_groups` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `name` VARCHAR(24) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `user_player_favorite_groups_user_name_unique`(`user_id`, `name`),
    INDEX `user_player_favorite_groups_user_created_idx`(`user_id`, `created_at`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `user_player_favorite_groups`
    ADD CONSTRAINT `user_player_favorite_groups_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `user_player_favorites`
    ADD COLUMN `group_id` CHAR(36) NULL,
    ADD INDEX `user_player_favorites_group_created_idx`(`user_id`, `group_id`, `created_at`, `id`),
    ADD CONSTRAINT `user_player_favorites_group_id_fkey`
    FOREIGN KEY (`group_id`) REFERENCES `user_player_favorite_groups`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
