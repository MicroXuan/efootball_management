-- Keep player categories aligned with the eight values exposed by PESDATA.
ALTER TABLE `player_cards`
    MODIFY `card_type` ENUM(
        'STANDARD',
        'LEGENDARY',
        'EPIC',
        'BIG_TIME',
        'TRENDING',
        'FEATURED',
        'HIGHLIGHT',
        'SHOW_TIME',
        'OTHER'
    ) NOT NULL;
