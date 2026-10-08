-- Reconcile databases that recorded the automatic-overall migration while
-- temporarily running a branch that still used the legacy DT column names.
SET @rename_min_overall = (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'league_salary_tiers'
        AND COLUMN_NAME = 'min_dt_rating'
    ),
    'ALTER TABLE `league_salary_tiers` CHANGE COLUMN `min_dt_rating` `min_overall` TINYINT UNSIGNED NOT NULL',
    'SELECT 1'
  )
);
PREPARE rename_min_overall_statement FROM @rename_min_overall;
EXECUTE rename_min_overall_statement;
DEALLOCATE PREPARE rename_min_overall_statement;

SET @rename_max_overall = (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'league_salary_tiers'
        AND COLUMN_NAME = 'max_dt_rating'
    ),
    'ALTER TABLE `league_salary_tiers` CHANGE COLUMN `max_dt_rating` `max_overall` TINYINT UNSIGNED NOT NULL',
    'SELECT 1'
  )
);
PREPARE rename_max_overall_statement FROM @rename_max_overall;
EXECUTE rename_max_overall_statement;
DEALLOCATE PREPARE rename_max_overall_statement;

-- The guarded backfill in 20261007090000_auto_overall_salary guarantees
-- every ownership has a snapshot before this constraint is restored.
ALTER TABLE `league_player_ownerships`
  MODIFY COLUMN `max_overall_snapshot` TINYINT UNSIGNED NOT NULL,
  MODIFY COLUMN `dt_rating_snapshot` TINYINT UNSIGNED NULL;
