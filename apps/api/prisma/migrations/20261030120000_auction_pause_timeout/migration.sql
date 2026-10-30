ALTER TABLE `player_auction_batches` ADD COLUMN `paused_at` DATETIME(3) NULL;

-- Legacy manual pauses have no dedicated timestamp. updated_at is a
-- conservative fallback: subsequent edits may delay cancellation, never hasten it.
UPDATE `player_auction_batches`
SET `paused_at` = CASE WHEN `status` = 'RECOVERY_REQUIRED'
  THEN COALESCE(`recovery_detected_at`, `updated_at`) ELSE `updated_at` END
WHERE `status` IN ('PAUSED', 'RECOVERY_REQUIRED');

CREATE INDEX `player_auction_batches_pause_timeout_idx`
ON `player_auction_batches` (`status`, `paused_at`);
