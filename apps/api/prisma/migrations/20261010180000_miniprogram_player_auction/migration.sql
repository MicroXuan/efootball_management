ALTER TABLE `player_auction_batches`
  ADD COLUMN `bid_channel` ENUM('WECHAT_GROUP', 'MINIPROGRAM') NOT NULL DEFAULT 'WECHAT_GROUP' AFTER `group_binding_id`;

ALTER TABLE `player_auction_bids`
  ADD COLUMN `source` ENUM('WECHAT_GROUP', 'MINIPROGRAM') NOT NULL DEFAULT 'WECHAT_GROUP' AFTER `identity_binding_id`,
  ADD COLUMN `idempotency_key` VARCHAR(128) NULL AFTER `source`,
  ADD COLUMN `submitted_at` DATETIME(3) NULL AFTER `wechat_sent_at`,
  MODIFY COLUMN `inbound_message_id` CHAR(36) NULL,
  MODIFY COLUMN `wechat_message_id` VARCHAR(256) NULL,
  MODIFY COLUMN `wechat_sort_key` VARCHAR(128) NULL,
  MODIFY COLUMN `wechat_sent_at` DATETIME(3) NULL;

UPDATE `player_auction_bids`
SET `submitted_at` = `wechat_sent_at`
WHERE `submitted_at` IS NULL;

ALTER TABLE `player_auction_bids`
  MODIFY COLUMN `submitted_at` DATETIME(3) NOT NULL,
  ADD UNIQUE INDEX `player_auction_bids_user_idempotency_unique` (`lot_id`, `user_id`, `idempotency_key`),
  ADD INDEX `player_auction_bids_submitted_order_idx` (`lot_id`, `submitted_at`, `id`);
