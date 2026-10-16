import { GUARDS_METADATA } from '@nestjs/common/constants';
import { jest } from '@jest/globals';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ActionCenterController } from './action-center.controller.js';

describe('ActionCenterController', () => {
  it('protects the center and scopes it to the authenticated user', async () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, ActionCenterController) as unknown[];
    expect(guards).toContain(JwtAuthGuard);
    const service = { get: jest.fn(async () => ({ items: [], actionRequiredCount: 0 })) };
    const controller = new ActionCenterController(service as never);

    await controller.get({ id: 'user-1', status: 'ACTIVE' });

    expect(service.get).toHaveBeenCalledWith('user-1');
  });
});
