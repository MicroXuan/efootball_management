ALTER TABLE `match_result_versions`
  MODIFY `submitted_by_id` CHAR(36) NULL,
  ADD COLUMN `submitted_by_admin_id` CHAR(36) NULL AFTER `submitted_by_id`,
  ADD INDEX `match_result_versions_admin_submitter_idx` (`submitted_by_admin_id`),
  ADD CONSTRAINT `match_result_versions_admin_submitter_fkey`
    FOREIGN KEY (`submitted_by_admin_id`) REFERENCES `admin_accounts` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
