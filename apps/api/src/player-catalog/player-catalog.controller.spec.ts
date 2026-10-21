import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PlayerCatalogController } from './player-catalog.controller.js';

describe('PlayerCatalogController authentication', () => {
  it('lets guests browse published players, cards, and packs', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PlayerCatalogController)).toBeUndefined();
    for (const handler of ['search', 'getPlayer', 'getCard', 'listPacks', 'getPack'] as const) {
      expect(Reflect.getMetadata(GUARDS_METADATA, PlayerCatalogController.prototype[handler])).toBeUndefined();
    }
  });
});
