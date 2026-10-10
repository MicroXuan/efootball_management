CREATE TABLE `wechat_group_capabilities` (
  `id` CHAR(36) NOT NULL,
  `group_binding_id` CHAR(36) NOT NULL,
  `capability` ENUM('SCHEDULE_QUERY', 'PLAYER_AUCTION') NOT NULL,
  `created_by_admin_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `wechat_group_capabilities_binding_capability_unique` (`group_binding_id`, `capability`),
  INDEX `wechat_group_capabilities_capability_binding_idx` (`capability`, `group_binding_id`),
  INDEX `wechat_group_capabilities_creator_idx` (`created_by_admin_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `wechat_group_capabilities_group_binding_id_fkey`
    FOREIGN KEY (`group_binding_id`) REFERENCES `wechat_group_bindings` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `wechat_group_capabilities_created_by_admin_id_fkey`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admin_accounts` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `wechat_group_capabilities`
  (`id`, `group_binding_id`, `capability`, `created_by_admin_id`, `created_at`)
SELECT UUID(), `group_binding_id`, 'SCHEDULE_QUERY', `created_by_admin_id`, CURRENT_TIMESTAMP(3)
FROM (
  SELECT
    `group_binding_id`,
    `created_by_admin_id`,
    ROW_NUMBER() OVER (
      PARTITION BY `group_binding_id`
      ORDER BY `created_at` ASC, `id` ASC
    ) AS `row_number`
  FROM `wechat_group_schedule_sources`
) AS `ranked_schedule_sources`
WHERE `row_number` = 1;

INSERT IGNORE INTO `wechat_group_capabilities`
  (`id`, `group_binding_id`, `capability`, `created_by_admin_id`, `created_at`)
SELECT UUID(), `group_binding_id`, 'PLAYER_AUCTION', `created_by_admin_id`, CURRENT_TIMESTAMP(3)
FROM (
  SELECT
    `group_binding_id`,
    `created_by_admin_id`,
    ROW_NUMBER() OVER (
      PARTITION BY `group_binding_id`
      ORDER BY `created_at` ASC, `id` ASC
    ) AS `row_number`
  FROM `player_auction_batches`
) AS `ranked_player_auction_batches`
WHERE `row_number` = 1;
