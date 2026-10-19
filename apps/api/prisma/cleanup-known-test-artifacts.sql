-- Only removes fixtures carrying the exact markers used by automated tests.
-- Review the SELECT statements first when running this manually on a shared database.
START TRANSACTION;

CREATE TEMPORARY TABLE cleanup_test_sources (id CHAR(36) PRIMARY KEY);
INSERT INTO cleanup_test_sources (id)
SELECT id FROM data_sources
WHERE name = 'Publisher test' AND code LIKE 'publisher-%';

CREATE TEMPORARY TABLE cleanup_test_cards (id CHAR(36) PRIMARY KEY, player_id CHAR(36));
INSERT INTO cleanup_test_cards (id, player_id)
SELECT pc.id, pc.player_id
FROM player_cards pc
JOIN cleanup_test_sources s ON s.id = pc.source_id;

CREATE TEMPORARY TABLE cleanup_test_players (id CHAR(36) PRIMARY KEY);
INSERT IGNORE INTO cleanup_test_players (id)
SELECT player_id FROM cleanup_test_cards;

CREATE TEMPORARY TABLE cleanup_test_skills (id CHAR(36) PRIMARY KEY);
INSERT IGNORE INTO cleanup_test_skills (id)
SELECT pcs.skill_id
FROM player_card_skills pcs
JOIN cleanup_test_cards c ON c.id = pcs.player_card_id;

DELETE fpbc FROM football_player_best_cards fpbc
JOIN cleanup_test_players p ON p.id = fpbc.football_player_id;
DELETE pcv FROM player_card_versions pcv
JOIN cleanup_test_cards c ON c.id = pcv.player_card_id;
DELETE cr FROM catalog_releases cr
JOIN import_batches ib ON ib.id = cr.batch_id
JOIN cleanup_test_sources s ON s.id = ib.source_id;
DELETE ib FROM import_batches ib
JOIN cleanup_test_sources s ON s.id = ib.source_id;
DELETE esr FROM external_sync_runs esr
JOIN cleanup_test_sources s ON s.id = esr.source_id;
DELETE pc FROM player_cards pc
JOIN cleanup_test_sources s ON s.id = pc.source_id;
DELETE cp FROM card_packs cp
JOIN cleanup_test_sources s ON s.id = cp.source_id;
DELETE fps FROM football_player_sources fps
JOIN cleanup_test_sources s ON s.id = fps.source_id;
DELETE fp FROM football_players fp
JOIN cleanup_test_players p ON p.id = fp.id
WHERE NOT EXISTS (SELECT 1 FROM player_cards pc WHERE pc.player_id = fp.id)
  AND NOT EXISTS (SELECT 1 FROM football_player_sources fps WHERE fps.player_id = fp.id);
DELETE sk FROM skills sk
JOIN cleanup_test_skills ts ON ts.id = sk.id
WHERE NOT EXISTS (SELECT 1 FROM player_card_skills pcs WHERE pcs.skill_id = sk.id);
DELETE ds FROM data_sources ds
JOIN cleanup_test_sources s ON s.id = ds.id;

CREATE TEMPORARY TABLE cleanup_dispute_users (id CHAR(36) PRIMARY KEY);
INSERT INTO cleanup_dispute_users (id)
SELECT id FROM users
WHERE display_name = '争议测试' AND wechat_open_id LIKE 'dispute-%';

CREATE TEMPORARY TABLE cleanup_arbitration_leagues (id CHAR(36) PRIMARY KEY);
INSERT INTO cleanup_arbitration_leagues (id)
SELECT l.id
FROM leagues l
JOIN cleanup_dispute_users u ON u.id = l.created_by_id
WHERE l.name = '仲裁' AND l.short_name = '仲裁'
  AND NOT EXISTS (SELECT 1 FROM league_teams lt WHERE lt.league_id = l.id)
  AND NOT EXISTS (
    SELECT 1 FROM competitions c
    JOIN league_seasons ls ON ls.id = c.season_id
    WHERE ls.league_id = l.id
  );

DELETE al FROM audit_logs al
JOIN cleanup_arbitration_leagues l ON l.id = al.league_id;
UPDATE leagues l
JOIN cleanup_arbitration_leagues t ON t.id = l.id
SET l.current_season_id = NULL;
DELETE ls FROM league_seasons ls
JOIN cleanup_arbitration_leagues l ON l.id = ls.league_id;
DELETE l FROM leagues l
JOIN cleanup_arbitration_leagues t ON t.id = l.id;

DROP TEMPORARY TABLE cleanup_arbitration_leagues;
DROP TEMPORARY TABLE cleanup_dispute_users;
DROP TEMPORARY TABLE cleanup_test_skills;
DROP TEMPORARY TABLE cleanup_test_players;
DROP TEMPORARY TABLE cleanup_test_cards;
DROP TEMPORARY TABLE cleanup_test_sources;

COMMIT;
