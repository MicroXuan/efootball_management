ALTER TABLE `finance_ledger_entries`
    ADD COLUMN `settlement_category` ENUM(
        'TRANSACTION_AMOUNT', 'LUXURY_TAX', 'OFFSEASON_FEE',
        'UNFINISHED_MATCH_PENALTY', 'PLAYER_AUCTION', 'TEAM_AUCTION',
        'ROOKIE_SELECTION', 'INSTALLMENT_PAYMENT', 'OTHER_ADJUSTMENT'
    ) NULL;

CREATE INDEX `finance_ledger_entries_settlement_idx`
    ON `finance_ledger_entries`(`league_team_id`, `season_id`, `settlement_category`);
