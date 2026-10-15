ALTER TABLE `roster_transactions`
  MODIFY `created_by_admin_id` CHAR(36) NULL,
  ADD COLUMN `created_by_user_id` CHAR(36) NULL AFTER `created_by_admin_id`,
  ADD INDEX `roster_transactions_user_creator_idx` (`created_by_user_id`),
  ADD CONSTRAINT `roster_transactions_created_by_user_fk`
    FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
