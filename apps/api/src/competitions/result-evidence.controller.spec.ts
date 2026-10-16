import { GUARDS_METADATA } from '@nestjs/common/constants';
import { jest } from '@jest/globals';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ResultEvidenceController } from './result-evidence.controller.js';

describe('ResultEvidenceController', () => {
  it('requires JWT authentication for every private object and session route', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ResultEvidenceController)).toContain(JwtAuthGuard);
  });

  it('passes authenticated user identity to create and complete', async () => {
    const service = {
      createUserUpload: jest.fn(async () => ({ id: 'upload' })),
      completeUserUpload: jest.fn(async () => ({ status: 'UPLOADED' }))
    };
    const controller = new ResultEvidenceController(service as never);
    const user = { id: 'user' } as never;
    const create = { role: 'SUBMITTER' as const, mimeType: 'image/png' as const, byteSize: 8, checksumSha256: 'a'.repeat(64), expectedVersion: 1 };
    await controller.create(user, 'match', create);
    await controller.complete(user, 'match', 'upload', { expectedVersion: 1 });
    expect(service.createUserUpload).toHaveBeenCalledWith('user', 'match', create);
    expect(service.completeUserUpload).toHaveBeenCalledWith('user', 'match', 'upload', { expectedVersion: 1 });
  });
});
