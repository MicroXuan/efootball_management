import { Body, Controller, Delete, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  CreatePlayerFavoriteRequestSchema,
  PlayerFavoriteListQuerySchema,
  PlayerFavoriteStatusQuerySchema,
  ResourceIdSchema,
  type CreatePlayerFavoriteRequest,
  type PlayerFavoriteListQuery,
  type PlayerFavoriteStatusQuery
} from '@efm/contracts';
import { CurrentUser, type CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { PlayerFavoritesService } from './player-favorites.service.js';

@Controller('me/player-favorites')
@UseGuards(JwtAuthGuard)
export class PlayerFavoritesController {
  constructor(@Inject(PlayerFavoritesService) private readonly favorites: PlayerFavoritesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(PlayerFavoriteListQuerySchema)) query: PlayerFavoriteListQuery
  ) {
    return this.favorites.list(user.id, query);
  }

  @Get('status')
  statuses(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(PlayerFavoriteStatusQuerySchema)) query: PlayerFavoriteStatusQuery
  ) {
    return this.favorites.statuses(user.id, query.playerIds);
  }

  @Post()
  favorite(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreatePlayerFavoriteRequestSchema)) body: CreatePlayerFavoriteRequest
  ) {
    return this.favorites.favorite(user.id, body.playerId);
  }

  @Delete(':playerId')
  unfavorite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('playerId', new ZodValidationPipe(ResourceIdSchema)) playerId: string
  ) {
    return this.favorites.unfavorite(user.id, playerId);
  }
}
