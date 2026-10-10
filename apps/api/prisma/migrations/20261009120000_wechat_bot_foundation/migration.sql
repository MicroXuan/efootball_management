CREATE TABLE `wechat_bot_devices` (
  `id` CHAR(36) NOT NULL,
  `name` VARCHAR(128) NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL,
  `wechat_account_id` VARCHAR(256) NULL,
  `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
  `login_status` ENUM('UNKNOWN', 'LOGGED_IN', 'LOGGED_OUT') NOT NULL DEFAULT 'UNKNOWN',
  `wechat_version` VARCHAR(64) NULL,
  `last_heartbeat_at` DATETIME(3) NULL,
  `listener_watermark` VARCHAR(256) NULL,
  `outbound_queue_depth` INTEGER UNSIGNED NOT NULL DEFAULT 0,
  `screen_locked` BOOLEAN NOT NULL DEFAULT false,
  `circuit_status` ENUM('CLOSED', 'OPEN') NOT NULL DEFAULT 'CLOSED',
  `circuit_reason` VARCHAR(512) NULL,
  `circuit_opened_at` DATETIME(3) NULL,
  `created_by_admin_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `wechat_bot_devices_wechat_account_id_key` (`wechat_account_id`),
  INDEX `wechat_bot_devices_status_heartbeat_idx` (`status`, `last_heartbeat_at`),
  INDEX `wechat_bot_devices_creator_idx` (`created_by_admin_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `wechat_bot_devices_created_by_admin_id_fkey`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admin_accounts` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `wechat_observed_groups` (
  `id` CHAR(36) NOT NULL,
  `device_id` CHAR(36) NOT NULL,
  `wechat_group_id` VARCHAR(256) NOT NULL,
  `display_name` VARCHAR(128) NOT NULL,
  `first_observed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_observed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `wechat_observed_groups_device_seen_idx` (`device_id`, `last_observed_at`),
  UNIQUE INDEX `wechat_observed_groups_device_group_unique` (`device_id`, `wechat_group_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `wechat_observed_groups_device_id_fkey`
    FOREIGN KEY (`device_id`) REFERENCES `wechat_bot_devices` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `wechat_group_bindings` (
  `id` CHAR(36) NOT NULL,
  `device_id` CHAR(36) NOT NULL,
  `observed_group_id` CHAR(36) NOT NULL,
  `wechat_group_id` VARCHAR(256) NOT NULL,
  `display_name` VARCHAR(128) NOT NULL,
  `league_id` CHAR(36) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `last_confirmed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `wechat_group_bindings_observed_group_id_key` (`observed_group_id`),
  INDEX `wechat_group_bindings_league_enabled_idx` (`league_id`, `enabled`),
  UNIQUE INDEX `wechat_group_bindings_device_group_unique` (`device_id`, `wechat_group_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `wechat_group_bindings_device_id_fkey`
    FOREIGN KEY (`device_id`) REFERENCES `wechat_bot_devices` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `wechat_group_bindings_observed_group_id_fkey`
    FOREIGN KEY (`observed_group_id`) REFERENCES `wechat_observed_groups` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `wechat_group_bindings_league_id_fkey`
    FOREIGN KEY (`league_id`) REFERENCES `leagues` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `wechat_group_schedule_sources` (
  `id` CHAR(36) NOT NULL,
  `group_binding_id` CHAR(36) NOT NULL,
  `competition_id` CHAR(36) NOT NULL,
  `display_order` INTEGER UNSIGNED NOT NULL DEFAULT 0,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `created_by_admin_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `wechat_group_schedule_sources_competition_idx` (`competition_id`),
  INDEX `wechat_group_schedule_sources_creator_idx` (`created_by_admin_id`),
  UNIQUE INDEX `wechat_group_schedule_sources_unique` (`group_binding_id`, `competition_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `wechat_group_schedule_sources_group_binding_id_fkey`
    FOREIGN KEY (`group_binding_id`) REFERENCES `wechat_group_bindings` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `wechat_group_schedule_sources_competition_id_fkey`
    FOREIGN KEY (`competition_id`) REFERENCES `competitions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `wechat_group_schedule_sources_created_by_admin_id_fkey`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admin_accounts` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `wechat_identity_bindings` (
  `id` CHAR(36) NOT NULL,
  `device_id` CHAR(36) NOT NULL,
  `wechat_contact_id` VARCHAR(256) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
  `bound_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `unbound_at` DATETIME(3) NULL,
  `revoked_reason` VARCHAR(512) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `wechat_identity_bindings_user_status_idx` (`user_id`, `status`),
  UNIQUE INDEX `wechat_identity_bindings_device_contact_unique` (`device_id`, `wechat_contact_id`),
  UNIQUE INDEX `wechat_identity_bindings_device_user_unique` (`device_id`, `user_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `wechat_identity_bindings_device_id_fkey`
    FOREIGN KEY (`device_id`) REFERENCES `wechat_bot_devices` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `wechat_identity_bindings_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `wechat_bridge_request_receipts` (
  `id` CHAR(36) NOT NULL,
  `device_id` CHAR(36) NOT NULL,
  `nonce` VARCHAR(128) NOT NULL,
  `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `wechat_bridge_request_receipts_received_idx` (`received_at`),
  UNIQUE INDEX `wechat_bridge_request_receipts_nonce_unique` (`device_id`, `nonce`),
  PRIMARY KEY (`id`),
  CONSTRAINT `wechat_bridge_request_receipts_device_id_fkey`
    FOREIGN KEY (`device_id`) REFERENCES `wechat_bot_devices` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `wechat_inbound_messages` (
  `id` CHAR(36) NOT NULL,
  `device_id` CHAR(36) NOT NULL,
  `message_id` VARCHAR(256) NOT NULL,
  `conversation_type` ENUM('GROUP', 'PRIVATE') NOT NULL,
  `conversation_id` VARCHAR(256) NOT NULL,
  `sender_id` VARCHAR(256) NOT NULL,
  `group_binding_id` CHAR(36) NULL,
  `wechat_sent_at` DATETIME(3) NOT NULL,
  `sequence` VARCHAR(128) NULL,
  `message_type` VARCHAR(16) NOT NULL DEFAULT 'TEXT',
  `command_text` VARCHAR(2000) NULL,
  `processing_status` ENUM('PENDING', 'PROCESSED', 'IGNORED', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `result_code` VARCHAR(64) NULL,
  `processed_at` DATETIME(3) NULL,
  `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `wechat_inbound_messages_group_time_idx` (`group_binding_id`, `wechat_sent_at`),
  INDEX `wechat_inbound_messages_sender_received_idx` (`sender_id`, `received_at`),
  INDEX `wechat_inbound_messages_processing_idx` (`processing_status`, `received_at`),
  UNIQUE INDEX `wechat_inbound_messages_device_message_unique` (`device_id`, `message_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `wechat_inbound_messages_device_id_fkey`
    FOREIGN KEY (`device_id`) REFERENCES `wechat_bot_devices` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `wechat_inbound_messages_group_binding_id_fkey`
    FOREIGN KEY (`group_binding_id`) REFERENCES `wechat_group_bindings` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `wechat_binding_codes` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `code_hash` CHAR(64) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `invalidated_at` DATETIME(3) NULL,
  `consumed_at` DATETIME(3) NULL,
  `consumed_by_device_id` CHAR(36) NULL,
  `consumed_by_contact_id` VARCHAR(256) NULL,
  `consumed_by_inbound_id` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `wechat_binding_codes_code_hash_key` (`code_hash`),
  UNIQUE INDEX `wechat_binding_codes_consumed_by_inbound_id_key` (`consumed_by_inbound_id`),
  INDEX `wechat_binding_codes_user_expiry_idx` (`user_id`, `expires_at`),
  INDEX `wechat_binding_codes_consumer_idx` (`consumed_by_device_id`, `consumed_by_contact_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `wechat_binding_codes_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `wechat_binding_codes_consumed_by_device_id_fkey`
    FOREIGN KEY (`consumed_by_device_id`) REFERENCES `wechat_bot_devices` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `wechat_binding_codes_consumed_by_inbound_id_fkey`
    FOREIGN KEY (`consumed_by_inbound_id`) REFERENCES `wechat_inbound_messages` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `wechat_outbox_messages` (
  `id` CHAR(36) NOT NULL,
  `device_id` CHAR(36) NOT NULL,
  `target_type` ENUM('GROUP', 'PRIVATE') NOT NULL,
  `target_id` VARCHAR(256) NOT NULL,
  `business_key` VARCHAR(191) NOT NULL,
  `text` VARCHAR(2000) NOT NULL,
  `priority` SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  `scheduled_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `status` ENUM('PENDING', 'LEASED', 'SENT', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `lease_owner` VARCHAR(128) NULL,
  `lease_expires_at` DATETIME(3) NULL,
  `attempt_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
  `readback_message_id` VARCHAR(256) NULL,
  `failure_code` VARCHAR(64) NULL,
  `failure_message` VARCHAR(512) NULL,
  `sent_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `wechat_outbox_messages_business_key_key` (`business_key`),
  INDEX `wechat_outbox_messages_claim_idx` (`device_id`, `status`, `scheduled_at`, `priority`),
  INDEX `wechat_outbox_messages_lease_idx` (`lease_expires_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `wechat_outbox_messages_device_id_fkey`
    FOREIGN KEY (`device_id`) REFERENCES `wechat_bot_devices` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
