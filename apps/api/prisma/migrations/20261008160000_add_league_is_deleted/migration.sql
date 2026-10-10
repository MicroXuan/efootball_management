ALTER TABLE `leagues`
  ADD COLUMN `is_deleted` BOOLEAN NOT NULL DEFAULT FALSE;

DROP INDEX `leagues_public_list_idx` ON `leagues`;

CREATE INDEX `leagues_public_list_idx`
  ON `leagues` (`is_deleted`, `status`, `created_at`, `id`);
