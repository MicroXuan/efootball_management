import { HEADERS_METADATA } from '@nestjs/common/constants';
import { GameAccountsController } from './game-accounts.controller.js';
import { TeamProfilesController } from '../leagues/team-profiles.controller.js';

function deprecationHeader(target: object, method: string) {
  const handler = (target as Record<string, unknown>)[method];
  const headers = Reflect.getMetadata(HEADERS_METADATA, handler as object) as
    | Array<{ name: string; value: string }>
    | undefined;
  return headers?.find(({ name }) => name.toLowerCase() === 'deprecation')?.value;
}

describe('legacy player write API boundary', () => {
  it.each([
    [GameAccountsController.prototype, 'create'],
    [GameAccountsController.prototype, 'update'],
    [GameAccountsController.prototype, 'delete'],
    [TeamProfilesController.prototype, 'create'],
    [TeamProfilesController.prototype, 'update'],
  ])('marks %s.%s as deprecated', (controller, method) => {
    expect(deprecationHeader(controller, method)).toBe('true');
  });

  it('keeps compatibility reads non-deprecated', () => {
    expect(deprecationHeader(GameAccountsController.prototype, 'list')).toBeUndefined();
    expect(deprecationHeader(TeamProfilesController.prototype, 'get')).toBeUndefined();
  });
});
