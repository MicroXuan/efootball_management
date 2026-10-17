import { jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { configureApplication } from './bootstrap.js';

function applicationDouble() {
  return {
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
});
