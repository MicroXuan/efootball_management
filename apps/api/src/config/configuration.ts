import { EnvironmentSchema } from './env.schema.js';

export function configuration() {
  const environment = EnvironmentSchema.parse(process.env);

  return {
    app: {
      environment: environment.NODE_ENV,
      port: environment.PORT
    },
    pesdata: {
      baseUrl: environment.PESDATA_BASE_URL,
      siteVersion: environment.PESDATA_SITE_VERSION,
      signatureSeed: environment.PESDATA_SIGNATURE_SEED,
      requestsPerSecond: environment.PESDATA_REQUESTS_PER_SECOND,
      timeoutMs: environment.PESDATA_TIMEOUT_MS,
      maxRetries: environment.PESDATA_MAX_RETRIES
    }
  };
}
