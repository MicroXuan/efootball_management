import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApplication } from './bootstrap.js';
import { configuration } from './config/configuration.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = configuration();
  configureApplication(app, { adminWebOrigins: config.app.adminWebOrigins });
  await app.listen(config.app.port, '0.0.0.0');
}

void bootstrap();
