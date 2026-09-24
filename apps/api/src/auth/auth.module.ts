import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { FakeWechatGateway } from './fake-wechat.gateway.js';
import { TokenService, TOKEN_CONFIG } from './token.service.js';
import { WechatHttpGateway } from './wechat-http.gateway.js';
import { WECHAT_GATEWAY } from './wechat.gateway.js';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    {
      provide: TOKEN_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        accessSecret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        refreshPepper: config.getOrThrow<string>('REFRESH_TOKEN_PEPPER')
      })
    },
    {
      provide: WECHAT_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        if (config.getOrThrow<string>('WECHAT_GATEWAY_MODE') === 'fake') {
          return new FakeWechatGateway();
        }
        return new WechatHttpGateway(
          config.getOrThrow<string>('WECHAT_APP_ID'),
          config.getOrThrow<string>('WECHAT_APP_SECRET')
        );
      }
    },
    AuthService,
    TokenService
  ],
  exports: [TokenService, WECHAT_GATEWAY]
})
export class AuthModule {}
