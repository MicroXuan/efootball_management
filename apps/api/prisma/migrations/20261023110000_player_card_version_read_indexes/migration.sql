CREATE INDEX `player_card_versions_player_release_idx` ON `player_card_versions`(`player_id`, `release_sequence`);
CREATE INDEX `player_card_versions_pack_release_idx` ON `player_card_versions`(`card_pack_id`, `release_sequence`);
CREATE INDEX `player_card_versions_catalog_order_idx` ON `player_card_versions`(`status`, `pack_release_date` DESC, `overall_rating` DESC, `published_at` DESC, `player_card_id`, `release_sequence`);
