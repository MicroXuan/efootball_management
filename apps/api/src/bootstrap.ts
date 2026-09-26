import type { INestApplication } from '@nestjs/common';
import { HttpErrorFilter } from './common/errors/http-error.filter.js';

type BodyParserApplication = INestApplication & {
  useBodyParser(type: string, options: { limit: string }): unknown;
};

export function configureApplication(app: INestApplication): void {
  (app as BodyParserApplication).useBodyParser('json', { limit: '10mb' });
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
  app.useGlobalFilters(new HttpErrorFilter());
}
