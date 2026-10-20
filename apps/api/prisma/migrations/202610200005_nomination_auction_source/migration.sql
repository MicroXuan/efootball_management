ALTER TABLE `player_auction_lots` ADD COLUMN `nomination_id` CHAR(36) NULL;
CREATE INDEX `player_auction_lots_nomination_idx` ON `player_auction_lots`(`nomination_id`);
ALTER TABLE `player_auction_lots` ADD CONSTRAINT `player_auction_lots_nomination_id_fkey`
  FOREIGN KEY (`nomination_id`) REFERENCES `player_nominations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
