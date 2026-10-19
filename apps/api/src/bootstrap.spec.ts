import { jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { configureApplication } from './bootstrap.js';

function applicationDouble() {
  return {
    use: jest.fn(),
    useBodyParser: jest.fn(),
    setGlobalPrefix: jest.fn(),
    enableShutdownHooks: jest.fn(),
    useGlobalFilters: jest.fn(),
    enableCors: jest.fn()
  };
}

describe('configureApplication', () => {
  it('allows browser requests only from configured admin origins', () => {
    const app = applicationDouble();

    configureApplication(app as unknown as INestApplication, {
      adminWebOrigins: ['https://admin-staging.example.com']
    });

    expect(app.enableCors).toHaveBeenCalledWith({
      origin: ['https://admin-staging.example.com']
    });
  });

  it('does not enable cross-origin browser access without an admin origin', () => {
    const app = applicationDouble();

    configureApplication(app as unknown as INestApplication);

    expect(app.enableCors).not.toHaveBeenCalled();
  });

  it('restores PATCH requests tunneled by the WeChat HTTP transport', () => {
    const app = applicationDouble();
    configureApplication(app as unknown as INestApplication);
    const middleware = app.use.mock.calls[0]?.[0] as (
      request: { method: string; headers: Record<string, string> },
      response: unknown,
      next: () => void,
    ) => void;
    const request = {
      method: 'POST',
      headers: { 'x-http-method-override': 'PATCH' },
    };
    const next = jest.fn();

    middleware(request, undefined, next);

    expect(request.method).toBe('PATCH');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
