ALTER TABLE `admin_mutation_receipts`
  ADD COLUMN `request_hash` CHAR(64) NULL AFTER `key`;
