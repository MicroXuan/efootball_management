import { validateEnvironment } from './env.schema.js';

const baseEnvironment = {
  NODE_ENV: 'production',
  DATABASE_URL: 'mysql://user:password@database.example.com:3306/efm',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  REFRESH_TOKEN_PEPPER: 'b'.repeat(32),
  WECHAT_APP_ID: 'wx-test',
  WECHAT_APP_SECRET: 'wechat-secret'
};

describe('environment schema', () => {
  it('normalizes a comma-separated admin origin allowlist', () => {
    const environment = validateEnvironment({
      ...baseEnvironment,
      ADMIN_WEB_ORIGINS: ' https://admin-a.example.com,https://admin-b.example.com/ '
    });

    expect(environment.ADMIN_WEB_ORIGINS).toEqual([
      'https://admin-a.example.com',
      'https://admin-b.example.com'
    ]);
  });

  it('rejects malformed admin origins', () => {
    expect(() => validateEnvironment({
      ...baseEnvironment,
      ADMIN_WEB_ORIGINS: 'https://admin.example.com,not-a-url'
    })).toThrow();
  });
});
