ALTER TABLE `player_card_versions`
  ADD COLUMN `normalized_card_name` VARCHAR(512) NULL,
  ADD COLUMN `normalized_pack_name_zh` VARCHAR(512) NULL,
  ADD COLUMN `normalized_pack_name_en` VARCHAR(512) NULL;
