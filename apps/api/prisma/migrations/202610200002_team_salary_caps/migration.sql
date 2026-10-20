ALTER TABLE `league_teams`
  ADD COLUMN `salary_cap_minor` INT UNSIGNED NULL,
  ADD COLUMN `salary_cap_confirmed_at` DATETIME(3) NULL;

-- Preserve the most recent effective league cap as an unconfirmed starting value.
-- Leagues with no effective rule remain NULL so acquisition checks can block safely.
UPDATE `league_teams` AS team
SET `salary_cap_minor` = (
  SELECT rule.`salary_cap_minor`
  FROM `league_salary_rule_versions` AS rule
  WHERE rule.`league_id` = team.`league_id`
    AND rule.`status` = 'ACTIVE'
    AND rule.`effective_at` <= CURRENT_TIMESTAMP(3)
  ORDER BY rule.`effective_at` DESC, rule.`version` DESC
  LIMIT 1
);
