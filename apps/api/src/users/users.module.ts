import { Module } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { GAME_ACCOUNT_USAGE_PORT, NoActiveGameAccountUsage } from './game-account-usage.port.js';
import { GameAccountsController } from './game-accounts.controller.js';
import { GameAccountsService } from './game-accounts.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AuthorizationModule, JwtModule.register({})],
  controllers: [UsersController, GameAccountsController],
  providers: [
    UsersService,
    GameAccountsService,
    JwtAuthGuard,
    JwtService,
    { provide: GAME_ACCOUNT_USAGE_PORT, useClass: NoActiveGameAccountUsage }
  ]
})
export class UsersModule {}
