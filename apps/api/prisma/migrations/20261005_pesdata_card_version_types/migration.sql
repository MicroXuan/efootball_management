-- Keep immutable card versions aligned with the categories stored on player cards.
ALTER TABLE `player_card_versions`
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
