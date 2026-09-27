import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes a password without storing the plaintext and verifies it', async () => {
    const hash = await service.hash('correct horse battery staple');

    expect(hash).not.toContain('correct horse battery staple');
    await expect(service.verify('correct horse battery staple', hash)).resolves.toBe(true);
    await expect(service.verify('wrong password', hash)).resolves.toBe(false);
  });
});
