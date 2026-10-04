ALTER TABLE `audit_logs`
    MODIFY `actor_admin_id` CHAR(36) NULL,
    ADD COLUMN `actor_user_id` CHAR(36) NULL;

CREATE INDEX `audit_logs_user_actor_idx`
    ON `audit_logs`(`actor_user_id`, `created_at`);

ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_user_id_fkey`
    FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
