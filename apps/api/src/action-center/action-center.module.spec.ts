import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DatabaseModule } from '../database/database.module.js';
import { PrismaService } from '../database/prisma.service.js';
import { ActionCenterModule } from './action-center.module.js';

describe('ActionCenterModule', () => {
  it('boots with the authentication dependencies required by its controller guard', async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule, ActionCenterModule]
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    await module.close();
  });
});
