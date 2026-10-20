UPDATE `player_auction_batches`
SET `group_binding_id` = NULL
WHERE `bid_channel` = 'MINIPROGRAM'
  AND `group_binding_id` IS NOT NULL;
