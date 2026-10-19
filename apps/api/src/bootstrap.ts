import type { INestApplication } from '@nestjs/common';
import { HttpErrorFilter } from './common/errors/http-error.filter.js';

type BodyParserApplication = INestApplication & {
  useBodyParser(type: string, options: { limit: string }): unknown;
};

type ApplicationOptions = {
  adminWebOrigins?: string[];
};

type MethodOverrideRequest = {
  method: string;
  headers: Record<string, string | string[] | undefined>;
};

export function configureApplication(app: INestApplication, options: ApplicationOptions = {}): void {
  app.use((request: MethodOverrideRequest, _response: unknown, next: () => void) => {
    if (
      request.method === 'POST'
      && request.headers['x-http-method-override'] === 'PATCH'
    ) {
      request.method = 'PATCH';
    }
    next();
  });
  (app as BodyParserApplication).useBodyParser('json', { limit: '10mb' });
  app.setGlobalPrefix('v1');
  if (options.adminWebOrigins?.length) {
    app.enableCors({ origin: options.adminWebOrigins });
  }
  app.enableShutdownHooks();
  app.useGlobalFilters(new HttpErrorFilter());
}
