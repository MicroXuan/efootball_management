CREATE INDEX `player_cards_reconciliation_active_idx`
  ON `player_cards`(`source_id`, `status`, `published_at`, `external_id`);

CREATE INDEX `player_catalog_reconciliation_items_run_batch_idx`
  ON `player_catalog_reconciliation_items`(`run_id`, `batch_id`);
