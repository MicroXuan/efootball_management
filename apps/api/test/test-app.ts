import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/bootstrap.js';

export async function createTestApp(): Promise<INestApplication> {
  process.env.NODE_ENV = 'test';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApplication(app);
  await app.init();
  return app;
}

