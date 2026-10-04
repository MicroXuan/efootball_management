import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PlayerFavoritesController } from './player-favorites.controller.js';
import { PlayerFavoritesService } from './player-favorites.service.js';

@Module({
  imports: [JwtModule.register({})],
  controllers: [PlayerFavoritesController],
  providers: [PlayerFavoritesService]
})
export class PlayerFavoritesModule {}
