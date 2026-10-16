ALTER TABLE `football_players`
  ADD COLUMN `club_zh` VARCHAR(128) NULL AFTER `club`,
  ADD COLUMN `club_en` VARCHAR(128) NULL AFTER `club_zh`;

UPDATE `football_players` AS `player`
INNER JOIN `football_player_best_cards` AS `best`
  ON `best`.`football_player_id` = `player`.`id`
INNER JOIN `player_card_attributes` AS `attributes`
  ON `attributes`.`player_card_id` = `best`.`player_card_id`
SET
  `player`.`club_zh` = COALESCE(
    NULLIF(NULLIF(
      JSON_UNQUOTE(JSON_EXTRACT(`attributes`.`attributes_json`, '$.sourceMetadata.team_cn')),
      'null'
    ), ''),
    `player`.`club_zh`
  ),
  `player`.`club_en` = COALESCE(
    NULLIF(NULLIF(
      JSON_UNQUOTE(JSON_EXTRACT(`attributes`.`attributes_json`, '$.sourceMetadata.team_en')),
      'null'
    ), ''),
    `player`.`club_en`
  )
WHERE `player`.`club_zh` IS NULL OR `player`.`club_en` IS NULL;
