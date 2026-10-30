CREATE TABLE `wechat_observed_members` (
  `id` CHAR(36) NOT NULL,
  `device_id` CHAR(36) NOT NULL,
  `wechat_group_id` VARCHAR(256) NOT NULL,
  `wechat_contact_id` VARCHAR(256) NOT NULL,
  `display_name` VARCHAR(128) NULL,
  `first_observed_at` DATETIME(3) NOT NULL,
  `last_observed_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `wechat_members_device_group_contact_key` (`device_id`, `wechat_group_id`, `wechat_contact_id`),
  INDEX `wechat_members_group_page_idx` (`device_id`, `wechat_group_id`, `id`),
  CONSTRAINT `wechat_members_device_fk` FOREIGN KEY (`device_id`) REFERENCES `wechat_bot_devices` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `wechat_identity_bindings` ADD COLUMN `version` INTEGER UNSIGNED NOT NULL DEFAULT 1;
