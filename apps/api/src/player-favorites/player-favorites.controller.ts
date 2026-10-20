import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  CreatePlayerFavoriteRequestSchema,
  CreatePlayerFavoriteGroupRequestSchema,
  MovePlayerFavoriteRequestSchema,
  PlayerFavoriteListQuerySchema,
  PlayerFavoriteStatusQuerySchema,
  ResourceIdSchema,
  type CreatePlayerFavoriteRequest,
  type CreatePlayerFavoriteGroupRequest,
  type MovePlayerFavoriteRequest,
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

  @Get('groups')
  groups(@CurrentUser() user: AuthenticatedUser) {
    return this.favorites.groups(user.id);
  }

  @Post('groups')
  createGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreatePlayerFavoriteGroupRequestSchema)) body: CreatePlayerFavoriteGroupRequest
  ) {
    return this.favorites.createGroup(user.id, body.name);
  }

  @Delete('groups/:groupId')
  deleteGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', new ZodValidationPipe(ResourceIdSchema)) groupId: string
  ) {
    return this.favorites.deleteGroup(user.id, groupId);
  }

  @Patch(':playerId/group')
  move(
    @CurrentUser() user: AuthenticatedUser,
    @Param('playerId', new ZodValidationPipe(ResourceIdSchema)) playerId: string,
    @Body(new ZodValidationPipe(MovePlayerFavoriteRequestSchema)) body: MovePlayerFavoriteRequest
  ) {
    return this.favorites.move(user.id, playerId, body.groupId);
  }

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
