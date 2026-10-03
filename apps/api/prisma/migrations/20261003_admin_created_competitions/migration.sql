-- Allow either a legacy user or an administrator to create a competition.
ALTER TABLE `competitions`
    MODIFY `created_by_id` CHAR(36) NULL,
    ADD COLUMN `created_by_admin_id` CHAR(36) NULL;

CREATE INDEX `competitions_admin_creator_idx` ON `competitions`(`created_by_admin_id`);

ALTER TABLE `competitions` ADD CONSTRAINT `competitions_created_by_admin_id_fkey`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admin_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
