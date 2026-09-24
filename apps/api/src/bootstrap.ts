import type { INestApplication } from '@nestjs/common';
import { HttpErrorFilter } from './common/errors/http-error.filter.js';

export function configureApplication(app: INestApplication): void {
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
  app.useGlobalFilters(new HttpErrorFilter());
}
