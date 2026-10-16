-- Preserve the cancellation decision in the immutable result timeline.
ALTER TABLE `match_result_events`
    MODIFY `type` ENUM(
        'RESULT_SUBMITTED',
        'RESULT_CONFIRMED',
        'RESULT_REJECTED',
        'CONFIRMATION_EXPIRED',
        'DISPUTE_OPENED',
        'EVIDENCE_UPLOADED',
        'EVIDENCE_REPLACED',
        'EVIDENCE_DEADLINE_EXPIRED',
        'ADMIN_DECIDED',
        'DISPUTE_CANCELLED',
        'EVIDENCE_DELETED'
    ) NOT NULL;

-- Pre-feature PENDING_CONFIRMATION rows have no deadline. Anchor the new
-- 24-hour window to their latest still-proposed score instead of deployment time.
UPDATE `competition_matches` AS `match_row`
INNER JOIN (
    SELECT `match_id`, MAX(`created_at`) AS `proposal_created_at`
    FROM `match_result_versions`
    WHERE `status` = 'PROPOSED'
    GROUP BY `match_id`
) AS `latest_proposal` ON `latest_proposal`.`match_id` = `match_row`.`id`
SET `match_row`.`result_confirmation_deadline_at` = DATE_ADD(`latest_proposal`.`proposal_created_at`, INTERVAL 24 HOUR)
WHERE `match_row`.`status` = 'PENDING_CONFIRMATION'
  AND `match_row`.`result_confirmation_deadline_at` IS NULL;
