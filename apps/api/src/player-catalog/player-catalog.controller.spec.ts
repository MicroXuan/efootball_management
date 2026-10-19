import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CatalogReadAuthGuard } from './catalog-read-auth.guard.js';
import { PlayerCatalogController } from './player-catalog.controller.js';

describe('PlayerCatalogController authentication', () => {
  it('protects every player, card, and pack read with catalog authentication', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PlayerCatalogController)).toContain(CatalogReadAuthGuard);
  });
});
