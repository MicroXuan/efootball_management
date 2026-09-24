import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { configuration } from './config/configuration.js';
import { validateEnvironment } from './config/env.schema.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
      load: [configuration],
      validate: validateEnvironment
    }),
    AuthModule,
    DatabaseModule,
    HealthModule
  ]
})
export class AppModule {}
