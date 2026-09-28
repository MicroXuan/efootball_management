CREATE TABLE `player_card_auto_builds` (
    `id` CHAR(36) NOT NULL,
    `player_card_id` CHAR(36) NOT NULL,
    `algorithm_version` VARCHAR(64) NOT NULL,
    `allocation_json` JSON NOT NULL,
    `max_overall` TINYINT UNSIGNED NOT NULL,
    `dt_rating` TINYINT UNSIGNED NULL,
    `calculated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `player_card_auto_builds_version_unique`(`player_card_id`, `algorithm_version`),
    INDEX `player_card_auto_builds_ranking_idx`(`algorithm_version`, `max_overall`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `football_player_best_cards` (
    `id` CHAR(36) NOT NULL,
    `football_player_id` CHAR(36) NOT NULL,
    `player_card_id` CHAR(36) NOT NULL,
    `auto_build_id` CHAR(36) NOT NULL,
    `selection_reason` JSON NOT NULL,
    `selected_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `football_player_best_cards_football_player_id_key`(`football_player_id`),
    UNIQUE INDEX `football_player_best_cards_auto_build_id_key`(`auto_build_id`),
    INDEX `football_player_best_cards_card_idx`(`player_card_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `player_card_auto_builds`
    ADD CONSTRAINT `player_card_auto_builds_player_card_id_fkey`
    FOREIGN KEY (`player_card_id`) REFERENCES `player_cards`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `football_player_best_cards`
    ADD CONSTRAINT `football_player_best_cards_football_player_id_fkey`
    FOREIGN KEY (`football_player_id`) REFERENCES `football_players`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `football_player_best_cards_player_card_id_fkey`
    FOREIGN KEY (`player_card_id`) REFERENCES `player_cards`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `football_player_best_cards_auto_build_id_fkey`
    FOREIGN KEY (`auto_build_id`) REFERENCES `player_card_auto_builds`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
