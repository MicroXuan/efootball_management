CREATE TABLE `user_player_favorites` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `football_player_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `user_player_favorites_user_player_unique`(`user_id`, `football_player_id`),
    INDEX `user_player_favorites_user_created_idx`(`user_id`, `created_at`, `id`),
    INDEX `user_player_favorites_player_idx`(`football_player_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `user_player_favorites`
    ADD CONSTRAINT `user_player_favorites_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `user_player_favorites_football_player_id_fkey`
    FOREIGN KEY (`football_player_id`) REFERENCES `football_players`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
